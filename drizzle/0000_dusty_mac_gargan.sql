CREATE TABLE `job` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`freelancer_address` text NOT NULL,
	`candidate_url` text,
	`content_url` text,
	`create_tx` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `search` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`brief` text NOT NULL,
	`candidates` text NOT NULL,
	`spent_usdc` real DEFAULT 0 NOT NULL,
	`warnings` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wallet` (
	`user_id` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`encrypted_key` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `x402_payment` (
	`id` text PRIMARY KEY NOT NULL,
	`search_id` text NOT NULL,
	`url` text NOT NULL,
	`amount_usdc` real NOT NULL,
	`tx_hash` text,
	`created_at` integer NOT NULL
);
