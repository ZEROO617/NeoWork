CREATE TABLE `chat_account_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `chat_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_account_sessions_token_hash_unique` ON `chat_account_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `account_sessions_account` ON `chat_account_sessions` (`account_id`);--> statement-breakpoint
CREATE TABLE `chat_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_accounts_session_id_unique` ON `chat_accounts` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_accounts_name_key_unique` ON `chat_accounts` (`name_key`);