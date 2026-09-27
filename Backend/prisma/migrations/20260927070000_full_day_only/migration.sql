-- Employee "whole days only, never a partial/split day" scheduling preference.
ALTER TABLE "Employee" ADD COLUMN "fullDayOnly" BOOLEAN NOT NULL DEFAULT false;
