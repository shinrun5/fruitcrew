-- Days on which nobody works more than one shift at the store (e.g. two morning
-- people and two different night people, never one person on both).
ALTER TABLE "Store" ADD COLUMN "noBackToBackDays" "DayOfWeek"[] DEFAULT ARRAY[]::"DayOfWeek"[];
