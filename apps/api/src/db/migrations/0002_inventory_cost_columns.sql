ALTER TABLE "inventory_items" ADD COLUMN "unit_cost" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "vendor_margin" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_cost_nonneg" CHECK ("inventory_items"."unit_cost" >= 0);--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_margin_range" CHECK ("inventory_items"."vendor_margin" between 0 and 100);