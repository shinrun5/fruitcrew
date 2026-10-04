-- Weekly hours a worker should get (a soft goal for the schedule generator).
ALTER TABLE "Employee" ADD COLUMN "targetHours" INTEGER;
