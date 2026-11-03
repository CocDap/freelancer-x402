// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FreelanceEscrow} from "../src/FreelanceEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @dev ERC-1271 smart wallet controlled by one EOA key, to check contract-wallet signers work.
contract Mock1271Wallet {
    address internal immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, sig);
        return err == ECDSA.RecoverError.NoError && signer == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

contract FreelanceEscrowTest is Test {
    FreelanceEscrow internal escrow;
    MockUSDC internal usdc;

    uint256 internal buyerPk = 0xB0B;
    uint256 internal freelancerPk = 0xF00D;
    uint256 internal strangerPk = 0xBAD;
    address internal buyer;
    address internal freelancer;
    address internal stranger;
    address internal relayer = address(0x5E1A7E5);

    uint256 internal constant AMOUNT = 100e6;
    bytes32 internal constant JOB = keccak256("job-1");

    bytes32 internal constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 internal constant ACTION_TYPEHASH =
        keccak256("Action(bytes32 jobId,uint8 kind,bytes32 data,uint32 actionNonce,uint256 deadline)");

    uint8 internal constant SUBMIT = 1;
    uint8 internal constant APPROVE = 2;
    uint8 internal constant REQUEST_REVISION = 3;
    uint8 internal constant REFUND = 4;
    uint8 internal constant DECLINE = 5;

    bytes32 internal constant CONTENT = keccak256("deliverable-v1");
    bytes32 internal constant CONTENT2 = keccak256("deliverable-v2");

    function setUp() public {
        vm.warp(1_700_000_000);
        buyer = vm.addr(buyerPk);
        freelancer = vm.addr(freelancerPk);
        stranger = vm.addr(strangerPk);
        usdc = new MockUSDC();
        escrow = new FreelanceEscrow(address(usdc));
        usdc.mint(buyer, 1_000e6);
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    function _terms() internal view returns (FreelanceEscrow.Terms memory t) {
        t = FreelanceEscrow.Terms({
            freelancer: freelancer,
            amount: AMOUNT,
            deliverDeadline: uint64(block.timestamp + 10 days),
            reviewWindow: 7 days,
            revisionWindow: 3 days,
            maxRevisions: 2
        });
    }

    function _usdcSig(bytes32 jobId, FreelanceEscrow.Terms memory t, uint256 pk) internal view returns (bytes memory) {
        bytes32 nonce = keccak256(abi.encode(jobId, t));
        bytes32 structHash = keccak256(
            abi.encode(
                RECEIVE_TYPEHASH, vm.addr(pk), address(escrow), t.amount, uint256(0), block.timestamp + 1 hours, nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _create(bytes32 jobId, FreelanceEscrow.Terms memory t) internal {
        bytes memory sig = _usdcSig(jobId, t, buyerPk);
        vm.prank(relayer);
        escrow.createJob(jobId, buyer, t, 0, block.timestamp + 1 hours, sig);
    }

    function _create() internal {
        _create(JOB, _terms());
    }

    function _actionSig(uint256 pk, bytes32 jobId, uint8 kind, bytes32 data, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        uint32 nonce = escrow.getJob(jobId).actionNonce;
        return _actionSigWithNonce(pk, jobId, kind, data, nonce, deadline);
    }

    function _actionSigWithNonce(uint256 pk, bytes32 jobId, uint8 kind, bytes32 data, uint32 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(ACTION_TYPEHASH, jobId, kind, data, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _dl() internal view returns (uint256) {
        return block.timestamp + 1 hours;
    }

    function _submit(bytes32 content) internal {
        uint256 dl = _dl();
        bytes memory sig = _actionSig(freelancerPk, JOB, SUBMIT, content, dl);
        vm.prank(relayer);
        escrow.submit(JOB, content, dl, sig);
    }

    function _requestRevision() internal {
        uint256 dl = _dl();
        bytes memory sig = _actionSig(buyerPk, JOB, REQUEST_REVISION, bytes32(0), dl);
        vm.prank(relayer);
        escrow.requestRevision(JOB, dl, sig);
    }

    function _state() internal view returns (FreelanceEscrow.State) {
        return escrow.getJob(JOB).state;
    }

    // ------------------------------------------------------------------
    // createJob
    // ------------------------------------------------------------------

    function test_createJob_locksFunds() public {
        _create();
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
        assertEq(usdc.balanceOf(buyer), 1_000e6 - AMOUNT);
        FreelanceEscrow.Job memory j = escrow.getJob(JOB);
        assertEq(uint8(j.state), uint8(FreelanceEscrow.State.Funded));
        assertEq(j.buyer, buyer);
        assertEq(j.freelancer, freelancer);
        assertEq(j.amount, AMOUNT);
        assertEq(j.maxRevisions, 2);
        assertEq(j.reviewWindow, 7 days);
        assertEq(j.revisionWindow, 3 days);
        assertEq(j.actionNonce, 0);
    }

    function test_createJob_emitsEvent() public {
        FreelanceEscrow.Terms memory t = _terms();
        bytes memory sig = _usdcSig(JOB, t, buyerPk);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit FreelanceEscrow.JobCreated(JOB, buyer, freelancer, AMOUNT);
        escrow.createJob(JOB, buyer, t, 0, _dl(), sig);
    }

    function test_jobNonce_matchesAbiEncode() public view {
        FreelanceEscrow.Terms memory t = _terms();
        assertEq(escrow.jobNonce(JOB, t), keccak256(abi.encode(JOB, t)));
    }

    function test_createJob_revertsIfTermsTampered() public {
        FreelanceEscrow.Terms memory t = _terms();
        bytes memory sig = _usdcSig(JOB, t, buyerPk);
        t.freelancer = stranger; // relayer swaps the freelancer after the buyer signed
        vm.expectRevert(MockUSDC.InvalidSignature.selector);
        escrow.createJob(JOB, buyer, t, 0, _dl(), sig);
    }

    function test_createJob_revertsIfJobIdTampered() public {
        FreelanceEscrow.Terms memory t = _terms();
        bytes memory sig = _usdcSig(JOB, t, buyerPk);
        vm.expectRevert(MockUSDC.InvalidSignature.selector);
        escrow.createJob(keccak256("other"), buyer, t, 0, _dl(), sig);
    }

    function test_createJob_revertsBadTerms() public {
        FreelanceEscrow.Terms memory t;

        t = _terms();
        t.freelancer = address(0);
        _expectBadTerms(t);

        t = _terms();
        t.freelancer = buyer;
        _expectBadTerms(t);

        t = _terms();
        t.amount = 0;
        _expectBadTerms(t);

        t = _terms();
        t.deliverDeadline = uint64(block.timestamp - 1);
        _expectBadTerms(t);

        t = _terms();
        t.deliverDeadline = uint64(block.timestamp); // must be strictly in the future
        _expectBadTerms(t);

        t = _terms();
        t.reviewWindow = 59;
        _expectBadTerms(t);

        t = _terms();
        t.revisionWindow = 59;
        _expectBadTerms(t);

        t = _terms();
        t.maxRevisions = 6;
        _expectBadTerms(t);

        t = _terms();
        t.freelancer = address(escrow);
        _expectBadTerms(t);
    }

    function _expectBadTerms(FreelanceEscrow.Terms memory t) internal {
        bytes memory sig = _usdcSig(JOB, t, buyerPk);
        vm.expectRevert(FreelanceEscrow.BadTerms.selector);
        escrow.createJob(JOB, buyer, t, 0, _dl(), sig);
    }

    function test_createJob_boundaryTermsAccepted() public {
        FreelanceEscrow.Terms memory t = _terms();
        t.reviewWindow = 60;
        t.revisionWindow = 60;
        t.maxRevisions = 5;
        t.deliverDeadline = uint64(block.timestamp + 1);
        _create(JOB, t);
        assertEq(uint8(_state()), uint8(FreelanceEscrow.State.Funded));
    }

    function test_createJob_revertsDuplicateId() public {
        _create();
        FreelanceEscrow.Terms memory t = _terms();
        t.amount = 5e6; // different terms -> different EIP-3009 nonce, so only JobExists can stop it
        bytes memory sig = _usdcSig(JOB, t, buyerPk);
        vm.expectRevert(FreelanceEscrow.JobExists.selector);
        escrow.createJob(JOB, buyer, t, 0, _dl(), sig);
    }

    function test_createJob_revertsMalformedUsdcSig() public {
        vm.expectRevert(FreelanceEscrow.BadSigner.selector);
        escrow.createJob(JOB, buyer, _terms(), 0, _dl(), hex"1234");
    }

    // ------------------------------------------------------------------
    // happy paths
    // ------------------------------------------------------------------

    function test_submit_thenApprove_paysFreelancer100() public {
        _create();
        vm.expectEmit(true, true, true, true, address(escrow));
        emit FreelanceEscrow.Submitted(JOB, CONTENT, 0);
        _submit(CONTENT);

        FreelanceEscrow.Job memory j = escrow.getJob(JOB);
        assertEq(uint8(j.state), uint8(FreelanceEscrow.State.Submitted));
        assertEq(j.submittedAt, block.timestamp);
        assertEq(j.contentHash, CONTENT);
        assertEq(j.actionNonce, 1);

        uint256 dl = _dl();
        bytes memory sig = _actionSig(buyerPk, JOB, APPROVE, bytes32(0), dl);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit FreelanceEscrow.Approved(JOB);
        escrow.approve(JOB, dl, sig);

        assertEq(uint8(_state()), uint8(FreelanceEscrow.State.Released));
        assertEq(usdc.balanceOf(freelancer), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_refund_afterDeadline_noSubmit_paysBuyer100() public {
        _create();
        vm.warp(escrow.getJob(JOB).deliverDeadline + 1);
        uint256 dl = _dl();
        bytes memory sig = _actionSig(buyerPk, JOB, REFUND, bytes32(0), dl);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit FreelanceEscrow.Refunded(JOB);
        escrow.refund(JOB, dl, sig);
        assertEq(uint8(_state()), uint8(FreelanceEscrow.State.Refunded));
        assertEq(usdc.balanceOf(buyer), 1_000e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_refund_beforeDeadline_reverts() public {
        _create();
        vm.warp(escrow.getJob(JOB).deliverDeadline); // exactly at deadline: still the freelancer's time
        uint256 dl = _dl();
        bytes memory sig = _actionSig(buyerPk, JOB, REFUND, bytes32(0), dl);
        vm.expectRevert(FreelanceEscrow.TooEarly.selector);
        escrow.refund(JOB, dl, sig);
    }

    function test_refund_afterSubmit_reverts() public {
        _create();
        _submit(CONTENT);
        vm.warp(escrow.getJob(JOB).deliverDeadline + 1);
        uint256 dl = _dl();
        bytes memory sig = _actionSig(buyerPk, JOB, REFUND, bytes32(0), dl);
        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.refund(JOB, dl, sig);
    }

    function test_decline_refundsBuyer() public {
        _create();
        uint256 dl = _dl();
        bytes memory sig = _actionSig(freelancerPk, JOB, DECLINE, bytes32(0), dl);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit FreelanceEscrow.Declined(JOB);
        escrow.decline(JOB, dl, sig);
        assertEq(uint8(_state()), uint8(FreelanceEscrow.State.Refunded));
        assertEq(usdc.balanceOf(buyer), 1_000e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_decline_afterSubmit_reverts() public {
        _create();
        _submit(CONTENT);
        uint256 dl = _dl();
        bytes memory sig = _actionSig(freelancerPk, JOB, DECLINE, bytes32(0), dl);
        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.decline(JOB, dl, sig);
    }

    function test_decline_byBuyer_reverts() public {
        _create();
        uint256 dl = _dl();
        bytes memory sig = _actionSig(buyerPk, JOB, DECLINE, bytes32(0), dl);
        vm.expectRevert(FreelanceEscrow.BadSigner.selector);
        escrow.decline(JOB, dl, sig);
    }

    function test_claim_afterReviewWindow_anyone_paysFreelancer() public {
        _create();
        _submit(CONTENT);
        FreelanceEscrow.Job memory j = escrow.getJob(JOB);
        vm.warp(uint256(j.submittedAt) + j.reviewWindow + 1);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit FreelanceEscrow.Claimed(JOB);
        vm.prank(stranger);
        escrow.claim(JOB);
        assertEq(uint8(_state()), uint8(FreelanceEscrow.State.Released));
        assertEq(usdc.balanceOf(freelancer), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_claim_beforeWindow_reverts() public {
        _create();
        _submit(CONTENT);
        FreelanceEscrow.Job memory j = escrow.getJob(JOB);
        vm.warp(uint256(j.submittedAt) + j.reviewWindow); // exactly at end of window: still buyer's time
        vm.expectRevert(FreelanceEscrow.TooEarly.selector);
        escrow.claim(JOB);
    }

    function test_claim_fromFunded_reverts() public {
        _create();
        vm.warp(block.timestamp + 365 days);
        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.claim(JOB);
    }

    function test_claim_twice_reverts() public {
        _create();
        _submit(CONTENT);
        vm.warp(block.timestamp + 8 days);
        escrow.claim(JOB);
        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.claim(JOB);
    }

    function test_approve_afterReviewWindow_stillAllowed() public {
        _create();
        _submit(CONTENT);
        vm.warp(block.timestamp + 30 days);
        uint256 dl = _dl();
        bytes memory sig = _actionSig(buyerPk, JOB, APPROVE, bytes32(0), dl);
        escrow.approve(JOB, dl, sig);
        assertEq(usdc.balanceOf(freelancer), AMOUNT);
    }

    function test_approve_fromFunded_reverts() public {
        _create();
        uint256 dl = _dl();
        bytes memory sig = _actionSig(buyerPk, JOB, APPROVE, bytes32(0), dl);
        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.approve(JOB, dl, sig);
    }

    function test_approve_fromRevisionRequested_reverts() public {
        _create();
        _submit(CONTENT);
        _requestRevision();
        uint256 dl = _dl();
        bytes memory sig = _actionSig(buyerPk, JOB, APPROVE, bytes32(0), dl);
        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.approve(JOB, dl, sig);
    }

    function test_approve_byFreelancer_reverts() public {
        _create();
        _submit(CONTENT);
        uint256 dl = _dl();
        bytes memory sig = _actionSig(freelancerPk, JOB, APPROVE, bytes32(0), dl);
        vm.expectRevert(FreelanceEscrow.BadSigner.selector);
        escrow.approve(JOB, dl, sig);
    }

    function test_unknownJob_reverts() public {
        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.claim(JOB);
        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.settleSplit(JOB);
        vm.prank(freelancer);
        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.submit(JOB, CONTENT, _dl(), "");
    }

    // ------------------------------------------------------------------
    // revisions
    // ------------------------------------------------------------------

    function test_requestRevision_thenResubmit_resetsSubmittedAt() public {
        _create();
        _submit(CONTENT);
        uint64 firstSubmittedAt = escrow.getJob(JOB).submittedAt;

        vm.warp(block.timestamp + 1 days);
        uint256 expectedRevisionDeadline = block.timestamp + 3 days;
        vm.expectEmit(true, true, true, true, address(escrow));
        emit FreelanceEscrow.RevisionRequested(JOB, uint64(expectedRevisionDeadline));
        _requestRevision();

        FreelanceEscrow.Job memory j = escrow.getJob(JOB);
        assertEq(uint8(j.state), uint8(FreelanceEscrow.State.RevisionRequested));
        assertEq(j.revisionCount, 1);
        assertEq(j.revisionDeadline, expectedRevisionDeadline);

        vm.warp(block.timestamp + 2 days);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit FreelanceEscrow.Submitted(JOB, CONTENT2, 1);
        _submit(CONTENT2);

        j = escrow.getJob(JOB);
        assertEq(uint8(j.state), uint8(FreelanceEscrow.State.Submitted));
        assertEq(j.submittedAt, block.timestamp);
        assertGt(j.submittedAt, firstSubmittedAt);
        assertEq(j.contentHash, CONTENT2);

        // the review window restarts from the new submission
        vm.warp(uint256(j.submittedAt) + j.reviewWindow);
        vm.expectRevert(FreelanceEscrow.TooEarly.selector);
        escrow.claim(JOB);
        vm.warp(uint256(j.submittedAt) + j.reviewWindow + 1);
        escrow.claim(JOB);
        assertEq(usdc.balanceOf(freelancer), AMOUNT);
    }

    function test_requestRevision_exceedsMax_reverts() public {
        _create(); // maxRevisions = 2
        _submit(CONTENT);
        _requestRevision();
        _submit(CONTENT2);
        _requestRevision();
        _submit(CONTENT);

        uint256 dl = _dl();
        bytes memory sig = _actionSig(buyerPk, JOB, REQUEST_REVISION, bytes32(0), dl);
        vm.expectRevert(FreelanceEscrow.NoRevisionsLeft.selector);
        escrow.requestRevision(JOB, dl, sig);
    }

    function test_requestRevision_zeroMax_reverts() public {
        FreelanceEscrow.Terms memory t = _terms();
        t.maxRevisions = 0;
        _create(JOB, t);
        _submit(CONTENT);
        uint256 dl = _dl();
        bytes memory sig = _actionSig(buyerPk, JOB, REQUEST_REVISION, bytes32(0), dl);
        vm.expectRevert(FreelanceEscrow.NoRevisionsLeft.selector);
        escrow.requestRevision(JOB, dl, sig);
    }

    function test_requestRevision_afterReviewWindow_reverts() public {
        _create();
        _submit(CONTENT);
        FreelanceEscrow.Job memory j = escrow.getJob(JOB);
        vm.warp(uint256(j.submittedAt) + j.reviewWindow + 1);
        uint256 dl = _dl();
        bytes memory sig = _actionSig(buyerPk, JOB, REQUEST_REVISION, bytes32(0), dl);
        vm.expectRevert(FreelanceEscrow.Expired.selector);
        escrow.requestRevision(JOB, dl, sig);
    }

    function test_requestRevision_atEndOfReviewWindow_ok() public {
        _create();
        _submit(CONTENT);
        FreelanceEscrow.Job memory j = escrow.getJob(JOB);
        vm.warp(uint256(j.submittedAt) + j.reviewWindow);
        _requestRevision();
        assertEq(uint8(_state()), uint8(FreelanceEscrow.State.RevisionRequested));
    }

    function test_requestRevision_fromFunded_reverts() public {
        _create();
        uint256 dl = _dl();
        bytes memory sig = _actionSig(buyerPk, JOB, REQUEST_REVISION, bytes32(0), dl);
        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.requestRevision(JOB, dl, sig);
    }

    function test_requestRevision_twiceInARow_reverts() public {
        _create();
        _submit(CONTENT);
        _requestRevision();
        uint256 dl = _dl();
        bytes memory sig = _actionSig(buyerPk, JOB, REQUEST_REVISION, bytes32(0), dl);
        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.requestRevision(JOB, dl, sig);
    }

    function test_requestRevision_byFreelancer_reverts() public {
        _create();
        _submit(CONTENT);
        uint256 dl = _dl();
        bytes memory sig = _actionSig(freelancerPk, JOB, REQUEST_REVISION, bytes32(0), dl);
        vm.expectRevert(FreelanceEscrow.BadSigner.selector);
        escrow.requestRevision(JOB, dl, sig);
    }

    function test_settleSplit_afterRevisionDeadline_splits() public {
        FreelanceEscrow.Terms memory t = _terms();
        t.amount = 100e6 + 1;
        _create(JOB, t);
        _submit(CONTENT);
        _requestRevision();
        vm.warp(escrow.getJob(JOB).revisionDeadline + 1);

        uint256 buyerBefore = usdc.balanceOf(buyer);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit FreelanceEscrow.SplitSettled(JOB, 50e6, 50e6 + 1);
        vm.prank(stranger);
        escrow.settleSplit(JOB);

        assertEq(uint8(_state()), uint8(FreelanceEscrow.State.Split));
        assertEq(usdc.balanceOf(buyer) - buyerBefore, 50e6);
        assertEq(usdc.balanceOf(freelancer), 50e6 + 1);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_settleSplit_beforeDeadline_reverts() public {
        _create();
        _submit(CONTENT);
        _requestRevision();
        vm.warp(escrow.getJob(JOB).revisionDeadline); // exactly at deadline: freelancer may still resubmit
        vm.expectRevert(FreelanceEscrow.TooEarly.selector);
        escrow.settleSplit(JOB);
    }

    function test_settleSplit_fromSubmitted_reverts() public {
        _create();
        _submit(CONTENT);
        vm.warp(block.timestamp + 365 days);
        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.settleSplit(JOB);
    }

    function test_resubmit_atRevisionDeadline_ok_afterIt_reverts() public {
        _create();
        _submit(CONTENT);
        _requestRevision();
        uint256 rd = escrow.getJob(JOB).revisionDeadline;

        uint256 snap = vm.snapshotState();
        vm.warp(rd);
        _submit(CONTENT2);
        assertEq(uint8(_state()), uint8(FreelanceEscrow.State.Submitted));
        vm.revertToState(snap);

        vm.warp(rd + 1);
        uint256 dl = _dl();
        bytes memory sig = _actionSig(freelancerPk, JOB, SUBMIT, CONTENT2, dl);
        vm.expectRevert(FreelanceEscrow.Expired.selector);
        escrow.submit(JOB, CONTENT2, dl, sig);
    }

    function test_refund_inRevisionRequested_reverts() public {
        _create();
        _submit(CONTENT);
        _requestRevision();
        vm.warp(block.timestamp + 365 days);
        uint256 dl = _dl();
        bytes memory sig = _actionSig(buyerPk, JOB, REFUND, bytes32(0), dl);
        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.refund(JOB, dl, sig);
    }

    // ------------------------------------------------------------------
    // submit timing
    // ------------------------------------------------------------------

    function test_submit_atDeliverDeadline_ok() public {
        _create();
        vm.warp(escrow.getJob(JOB).deliverDeadline);
        _submit(CONTENT);
        assertEq(uint8(_state()), uint8(FreelanceEscrow.State.Submitted));
    }

    function test_submit_afterDeliverDeadline_reverts() public {
        _create();
        vm.warp(escrow.getJob(JOB).deliverDeadline + 1);
        uint256 dl = _dl();
        bytes memory sig = _actionSig(freelancerPk, JOB, SUBMIT, CONTENT, dl);
        vm.expectRevert(FreelanceEscrow.Expired.selector);
        escrow.submit(JOB, CONTENT, dl, sig);
    }

    function test_submit_fromSubmitted_reverts() public {
        _create();
        _submit(CONTENT);
        uint256 dl = _dl();
        bytes memory sig = _actionSig(freelancerPk, JOB, SUBMIT, CONTENT2, dl);
        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.submit(JOB, CONTENT2, dl, sig);
    }

    // ------------------------------------------------------------------
    // signatures
    // ------------------------------------------------------------------

    function test_replaySignature_reverts() public {
        _create();
        uint256 dl = _dl();
        bytes memory sig = _actionSig(freelancerPk, JOB, SUBMIT, CONTENT, dl);
        escrow.submit(JOB, CONTENT, dl, sig);
        _requestRevision(); // back in a state where submit is allowed
        vm.expectRevert(FreelanceEscrow.BadSigner.selector);
        escrow.submit(JOB, CONTENT, dl, sig);
    }

    function test_signatureForOtherJob_reverts() public {
        _create();
        bytes32 job2 = keccak256("job-2");
        _create(job2, _terms());
        uint256 dl = _dl();
        bytes memory sig = _actionSig(freelancerPk, job2, DECLINE, bytes32(0), dl);
        vm.expectRevert(FreelanceEscrow.BadSigner.selector);
        escrow.decline(JOB, dl, sig);
    }

    function test_signatureForOtherKind_reverts() public {
        _create();
        uint256 dl = _dl();
        // freelancer signed a Submit, relayer tries to use it as Decline
        bytes memory sig = _actionSig(freelancerPk, JOB, SUBMIT, bytes32(0), dl);
        vm.expectRevert(FreelanceEscrow.BadSigner.selector);
        escrow.decline(JOB, dl, sig);
    }

    function test_submit_contentHashTampered_reverts() public {
        _create();
        uint256 dl = _dl();
        bytes memory sig = _actionSig(freelancerPk, JOB, SUBMIT, CONTENT, dl);
        vm.expectRevert(FreelanceEscrow.BadSigner.selector);
        escrow.submit(JOB, CONTENT2, dl, sig);
    }

    function test_signatureForOtherContract_reverts() public {
        FreelanceEscrow other = new FreelanceEscrow(address(usdc));
        _create();
        uint256 dl = _dl();
        bytes32 structHash = keccak256(abi.encode(ACTION_TYPEHASH, JOB, DECLINE, bytes32(0), uint32(0), dl));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", other.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(freelancerPk, digest);
        vm.expectRevert(FreelanceEscrow.BadSigner.selector);
        escrow.decline(JOB, dl, abi.encodePacked(r, s, v));
    }

    function test_signatureForOtherChain_reverts() public {
        _create();
        uint256 dl = _dl();
        bytes memory sig = _actionSig(freelancerPk, JOB, DECLINE, bytes32(0), dl); // signed for chain 31337
        vm.chainId(43113);
        vm.expectRevert(FreelanceEscrow.BadSigner.selector);
        escrow.decline(JOB, dl, sig);
    }

    function test_domainSeparator_matchesEip712() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("FreelanceEscrow"),
                keccak256("1"),
                block.chainid,
                address(escrow)
            )
        );
        assertEq(escrow.domainSeparator(), expected);
    }

    function test_wrongSigner_reverts() public {
        _create();
        uint256 dl = _dl();
        bytes memory sig = _actionSig(buyerPk, JOB, SUBMIT, CONTENT, dl);
        vm.expectRevert(FreelanceEscrow.BadSigner.selector);
        escrow.submit(JOB, CONTENT, dl, sig);
    }

    function test_expiredSignature_reverts() public {
        _create();
        uint256 dl = block.timestamp + 10;
        bytes memory sig = _actionSig(freelancerPk, JOB, SUBMIT, CONTENT, dl);
        vm.warp(dl + 1);
        vm.expectRevert(FreelanceEscrow.Expired.selector);
        escrow.submit(JOB, CONTENT, dl, sig);
    }

    function test_signatureAtDeadline_ok() public {
        _create();
        uint256 dl = block.timestamp + 10;
        bytes memory sig = _actionSig(freelancerPk, JOB, SUBMIT, CONTENT, dl);
        vm.warp(dl);
        escrow.submit(JOB, CONTENT, dl, sig);
        assertEq(uint8(_state()), uint8(FreelanceEscrow.State.Submitted));
    }

    function test_freelancerDirectCall_noSig_submits() public {
        _create();
        vm.prank(freelancer);
        escrow.submit(JOB, CONTENT, 0, "");
        FreelanceEscrow.Job memory j = escrow.getJob(JOB);
        assertEq(uint8(j.state), uint8(FreelanceEscrow.State.Submitted));
        assertEq(j.contentHash, CONTENT);
        assertEq(j.actionNonce, 1);
    }

    function test_directCall_noSig_wrongSender_reverts() public {
        _create();
        vm.prank(stranger);
        vm.expectRevert(FreelanceEscrow.BadSigner.selector);
        escrow.submit(JOB, CONTENT, 0, "");
    }

    function test_buyerDirectCall_noSig_approves() public {
        _create();
        _submit(CONTENT);
        vm.prank(buyer);
        escrow.approve(JOB, 0, "");
        assertEq(usdc.balanceOf(freelancer), AMOUNT);
    }

    function test_directAction_invalidatesPendingSignature() public {
        _create();
        _submit(CONTENT);
        // buyer signed an approve, but then requested a revision directly
        uint256 dl = _dl();
        bytes memory approveSig = _actionSig(buyerPk, JOB, APPROVE, bytes32(0), dl);
        vm.prank(buyer);
        escrow.requestRevision(JOB, 0, "");
        vm.prank(freelancer);
        escrow.submit(JOB, CONTENT2, 0, "");
        vm.expectRevert(FreelanceEscrow.BadSigner.selector);
        escrow.approve(JOB, dl, approveSig);
    }

    // ------------------------------------------------------------------
    // terminal states are final
    // ------------------------------------------------------------------

    function test_terminalStates_rejectEverything() public {
        _create();
        vm.prank(freelancer);
        escrow.decline(JOB, 0, "");
        assertEq(uint8(_state()), uint8(FreelanceEscrow.State.Refunded));

        vm.startPrank(freelancer);
        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.submit(JOB, CONTENT, 0, "");
        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.decline(JOB, 0, "");
        vm.stopPrank();

        vm.startPrank(buyer);
        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.refund(JOB, 0, "");
        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.approve(JOB, 0, "");
        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.requestRevision(JOB, 0, "");
        vm.stopPrank();

        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.claim(JOB);
        vm.expectRevert(FreelanceEscrow.BadState.selector);
        escrow.settleSplit(JOB);
    }

    function test_erc1271Freelancer_signedSubmit() public {
        Mock1271Wallet wallet = new Mock1271Wallet(freelancer);
        FreelanceEscrow.Terms memory t = _terms();
        t.freelancer = address(wallet);
        _create(JOB, t);

        uint256 dl = _dl();
        bytes memory badSig = _actionSig(strangerPk, JOB, SUBMIT, CONTENT, dl);
        vm.expectRevert(FreelanceEscrow.BadSigner.selector);
        escrow.submit(JOB, CONTENT, dl, badSig);

        bytes memory sig = _actionSig(freelancerPk, JOB, SUBMIT, CONTENT, dl);
        escrow.submit(JOB, CONTENT, dl, sig);
        assertEq(uint8(_state()), uint8(FreelanceEscrow.State.Submitted));
    }

    function test_mockUsdc_metadata() public view {
        assertEq(usdc.name(), "USD Coin");
        assertEq(usdc.version(), "2");
        assertEq(usdc.decimals(), 6);
    }
}
