CREATE TABLE `chat_files` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`member_id` text NOT NULL,
	`filename` text NOT NULL,
	`size` integer NOT NULL,
	`storage_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `chat_rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `chat_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_files_storage_key_unique` ON `chat_files` (`storage_key`);--> statement-breakpoint
CREATE INDEX `files_room` ON `chat_files` (`room_id`);--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `file_id` text REFERENCES chat_files(id);