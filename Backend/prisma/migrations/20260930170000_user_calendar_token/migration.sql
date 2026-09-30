-- Secret for each person's calendar feed link (subscribe from Apple/Google/Outlook Calendar).
ALTER TABLE "User" ADD COLUMN "calendarToken" TEXT;

CREATE UNIQUE INDEX "User_calendarToken_key" ON "User"("calendarToken");
