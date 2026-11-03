// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Minimal EIP-3009 surface used for funding (USDC FiatToken v2+).
interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @title FreelanceEscrow
/// @notice Multi-job USDC escrow between a buyer and a freelancer. A relayer submits every transaction and
///         pays gas; the parties only sign. Funding uses EIP-3009 `receiveWithAuthorization` whose nonce is
///         `jobNonce(jobId, terms)`, so the buyer's USDC signature is also their signature over the job terms.
///         Every other party action is an EIP-712 `Action` signature (or a direct call by that party).
///
/// @dev TIMESTAMP CONVENTION (used everywhere in this contract):
///      a deadline `D` is INCLUSIVE for the party acting "before" it and the "after" action needs `> D`.
///        - signed action valid while        block.timestamp <= deadline
///        - submit (Funded) valid while      block.timestamp <= deliverDeadline;   refund needs  > deliverDeadline
///        - requestRevision valid while      block.timestamp <= submittedAt + reviewWindow; claim needs > that
///        - resubmit valid while             block.timestamp <= revisionDeadline;  settleSplit needs > revisionDeadline
///      So at every boundary exactly one side may act; there is no gap and no overlap.
contract FreelanceEscrow is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        None,
        Funded,
        Submitted,
        RevisionRequested,
        Released,
        Refunded,
        Split
    }

    struct Terms {
        address freelancer;
        uint256 amount;
        uint64 deliverDeadline;
        uint32 reviewWindow;
        uint32 revisionWindow;
        uint8 maxRevisions;
    }

    struct Job {
        address buyer;
        address freelancer;
        uint256 amount;
        uint64 deliverDeadline;
        uint32 reviewWindow;
        uint32 revisionWindow;
        uint8 maxRevisions;
        uint8 revisionCount;
        uint64 submittedAt;
        uint64 revisionDeadline;
        uint32 actionNonce;
        State state;
        bytes32 contentHash;
    }

    /// @dev EIP-712 type string. `data` is the contentHash for Submit and bytes32(0) for every other kind.
    bytes32 public constant ACTION_TYPEHASH =
        keccak256("Action(bytes32 jobId,uint8 kind,bytes32 data,uint32 actionNonce,uint256 deadline)");

    uint8 public constant KIND_SUBMIT = 1;
    uint8 public constant KIND_APPROVE = 2;
    uint8 public constant KIND_REQUEST_REVISION = 3;
    uint8 public constant KIND_REFUND = 4;
    uint8 public constant KIND_DECLINE = 5;

    uint32 public constant MIN_WINDOW = 60;
    uint8 public constant MAX_REVISIONS = 5;

    IERC20 public immutable usdc;

    mapping(bytes32 => Job) private _jobs;

    event JobCreated(bytes32 indexed jobId, address indexed buyer, address indexed freelancer, uint256 amount);
    event Submitted(bytes32 indexed jobId, bytes32 contentHash, uint8 revisionCount);
    event Approved(bytes32 indexed jobId);
    event RevisionRequested(bytes32 indexed jobId, uint64 revisionDeadline);
    event Refunded(bytes32 indexed jobId);
    event Declined(bytes32 indexed jobId);
    event Claimed(bytes32 indexed jobId);
    event SplitSettled(bytes32 indexed jobId, uint256 buyerAmount, uint256 freelancerAmount);

    /// @notice Action not allowed in the job's current state (also: unknown job).
    error BadState();
    /// @notice Signature (or direct caller) is not the party required for this action, or is malformed.
    error BadSigner();
    /// @notice Signature deadline passed, or the time window for this action is over.
    error Expired();
    /// @notice The time window that unlocks this action has not ended yet.
    error TooEarly();
    error BadTerms();
    error JobExists();
    error NoRevisionsLeft();

    constructor(address usdc_) EIP712("FreelanceEscrow", "1") {
        usdc = IERC20(usdc_);
    }

    // ------------------------------------------------------------------
    // views
    // ------------------------------------------------------------------

    /// @notice EIP-3009 nonce the buyer must sign: binds jobId and every term.
    function jobNonce(bytes32 jobId, Terms calldata t) public pure returns (bytes32) {
        return keccak256(abi.encode(jobId, t));
    }

    function getJob(bytes32 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ------------------------------------------------------------------
    // funding
    // ------------------------------------------------------------------

    /// @notice Callable by anyone (normally the relayer). Safety comes from the EIP-3009 nonce binding the
    ///         terms, and from `receiveWithAuthorization` only being callable by the payee (this contract).
    function createJob(
        bytes32 jobId,
        address buyer,
        Terms calldata t,
        uint256 validAfter,
        uint256 validBefore,
        bytes calldata usdcSig
    ) external nonReentrant {
        if (_jobs[jobId].state != State.None) revert JobExists();
        if (
            buyer == address(0) || t.freelancer == address(0) || t.freelancer == buyer || t.freelancer == address(this)
                || t.amount == 0 || t.deliverDeadline <= block.timestamp || t.reviewWindow < MIN_WINDOW
                || t.revisionWindow < MIN_WINDOW || t.maxRevisions > MAX_REVISIONS
        ) revert BadTerms();
        if (usdcSig.length != 65) revert BadSigner();

        Job storage j = _jobs[jobId];
        j.buyer = buyer;
        j.freelancer = t.freelancer;
        j.amount = t.amount;
        j.deliverDeadline = t.deliverDeadline;
        j.reviewWindow = t.reviewWindow;
        j.revisionWindow = t.revisionWindow;
        j.maxRevisions = t.maxRevisions;
        j.state = State.Funded;

        emit JobCreated(jobId, buyer, t.freelancer, t.amount);

        _pullFunds(buyer, t.amount, validAfter, validBefore, jobNonce(jobId, t), usdcSig);
    }

    // ------------------------------------------------------------------
    // freelancer actions
    // ------------------------------------------------------------------

    /// @notice Funded -> Submitted (until deliverDeadline) or RevisionRequested -> Submitted (until revisionDeadline).
    function submit(bytes32 jobId, bytes32 contentHash, uint256 deadline, bytes calldata sig) external nonReentrant {
        Job storage j = _jobs[jobId];
        State st = j.state;
        if (st == State.Funded) {
            if (block.timestamp > j.deliverDeadline) revert Expired();
        } else if (st == State.RevisionRequested) {
            if (block.timestamp > j.revisionDeadline) revert Expired();
        } else {
            revert BadState();
        }
        _authorize(j, jobId, KIND_SUBMIT, contentHash, deadline, sig, j.freelancer);

        j.state = State.Submitted;
        j.submittedAt = uint64(block.timestamp);
        j.contentHash = contentHash;
        emit Submitted(jobId, contentHash, j.revisionCount);
    }

    /// @notice Funded -> Refunded (100% to buyer). Freelancer turns the job down before submitting.
    function decline(bytes32 jobId, uint256 deadline, bytes calldata sig) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.state != State.Funded) revert BadState();
        _authorize(j, jobId, KIND_DECLINE, bytes32(0), deadline, sig, j.freelancer);

        j.state = State.Refunded;
        emit Declined(jobId);
        usdc.safeTransfer(j.buyer, j.amount);
    }

    // ------------------------------------------------------------------
    // buyer actions
    // ------------------------------------------------------------------

    /// @notice Submitted -> Released (100% to freelancer). Allowed at any time while Submitted.
    function approve(bytes32 jobId, uint256 deadline, bytes calldata sig) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.state != State.Submitted) revert BadState();
        _authorize(j, jobId, KIND_APPROVE, bytes32(0), deadline, sig, j.buyer);

        j.state = State.Released;
        emit Approved(jobId);
        usdc.safeTransfer(j.freelancer, j.amount);
    }

    /// @notice Submitted -> RevisionRequested, only within the review window and while revisions remain.
    function requestRevision(bytes32 jobId, uint256 deadline, bytes calldata sig) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.state != State.Submitted) revert BadState();
        if (block.timestamp > uint256(j.submittedAt) + j.reviewWindow) revert Expired();
        if (j.revisionCount >= j.maxRevisions) revert NoRevisionsLeft();
        _authorize(j, jobId, KIND_REQUEST_REVISION, bytes32(0), deadline, sig, j.buyer);

        uint64 revisionDeadline = uint64(block.timestamp + j.revisionWindow);
        j.revisionCount += 1;
        j.revisionDeadline = revisionDeadline;
        j.state = State.RevisionRequested;
        emit RevisionRequested(jobId, revisionDeadline);
    }

    /// @notice Funded -> Refunded (100% to buyer) once deliverDeadline has passed without a submission.
    function refund(bytes32 jobId, uint256 deadline, bytes calldata sig) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.state != State.Funded) revert BadState();
        if (block.timestamp <= j.deliverDeadline) revert TooEarly();
        _authorize(j, jobId, KIND_REFUND, bytes32(0), deadline, sig, j.buyer);

        j.state = State.Refunded;
        emit Refunded(jobId);
        usdc.safeTransfer(j.buyer, j.amount);
    }

    // ------------------------------------------------------------------
    // permissionless settlement
    // ------------------------------------------------------------------

    /// @notice Submitted -> Released (100% to freelancer) after the review window. Anyone may call.
    function claim(bytes32 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.state != State.Submitted) revert BadState();
        if (block.timestamp <= uint256(j.submittedAt) + j.reviewWindow) revert TooEarly();

        j.state = State.Released;
        emit Claimed(jobId);
        usdc.safeTransfer(j.freelancer, j.amount);
    }

    /// @notice RevisionRequested -> Split after revisionDeadline. Buyer gets floor(amount/2), freelancer the rest
    ///         (the odd smallest unit goes to the freelancer). Anyone may call.
    function settleSplit(bytes32 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.state != State.RevisionRequested) revert BadState();
        if (block.timestamp <= j.revisionDeadline) revert TooEarly();

        uint256 buyerAmount = j.amount / 2;
        uint256 freelancerAmount = j.amount - buyerAmount;
        j.state = State.Split;
        emit SplitSettled(jobId, buyerAmount, freelancerAmount);
        usdc.safeTransfer(j.buyer, buyerAmount);
        usdc.safeTransfer(j.freelancer, freelancerAmount);
    }

    // ------------------------------------------------------------------
    // internal
    // ------------------------------------------------------------------

    /// @dev EIP-3009 pull. `receiveWithAuthorization` requires `to == msg.sender`, so a front-runner cannot
    ///      redirect the buyer's authorization; a wrong jobId/terms changes `nonce` and the signature fails.
    function _pullFunds(
        address buyer,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata usdcSig
    ) private {
        bytes32 r = bytes32(usdcSig[0:32]);
        bytes32 s = bytes32(usdcSig[32:64]);
        uint8 v = uint8(usdcSig[64]);
        IERC3009(address(usdc)).receiveWithAuthorization(
            buyer, address(this), amount, validAfter, validBefore, nonce, v, r, s
        );
    }

    /// @dev Authorizes `expected` for this action and consumes the job's actionNonce.
    ///      Empty `sig`: `msg.sender` must be `expected` (direct call, e.g. via Snowtrace); `deadline` is ignored.
    ///      Otherwise: `deadline >= block.timestamp` and `sig` must be a valid EIP-712 Action signature by
    ///      `expected` (EOA via ECDSA or contract via ERC-1271) over the current actionNonce.
    ///      The nonce is bumped on every authorized action (direct or signed), which invalidates any other
    ///      outstanding signature for this job.
    function _authorize(
        Job storage j,
        bytes32 jobId,
        uint8 kind,
        bytes32 data,
        uint256 deadline,
        bytes calldata sig,
        address expected
    ) private {
        uint32 nonce = j.actionNonce;
        if (sig.length == 0) {
            if (msg.sender != expected) revert BadSigner();
        } else {
            if (deadline < block.timestamp) revert Expired();
            bytes32 digest =
                _hashTypedDataV4(keccak256(abi.encode(ACTION_TYPEHASH, jobId, kind, data, nonce, deadline)));
            if (!SignatureChecker.isValidSignatureNow(expected, digest, sig)) revert BadSigner();
        }
        j.actionNonce = nonce + 1;
    }
}
