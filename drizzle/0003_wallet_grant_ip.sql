ALTER TABLE `wallet` ADD `welcome_grant_ip_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_welcome_grant_ip_hash_unique` ON `wallet` (`welcome_grant_ip_hash`);