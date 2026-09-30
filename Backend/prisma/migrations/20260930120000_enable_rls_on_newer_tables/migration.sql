-- RLS was switched on by hand in the Supabase dashboard, so tables created by
-- later migrations came up with it off and were readable/writable through the
-- public API. The backend connects as the table owner and bypasses RLS, so
-- enabling it with no policies only locks out the anon/authenticated roles.
ALTER TABLE "AccountDeletionRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClosingDutyAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeResponsibility" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Responsibility" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScheduleEditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShiftCounterOffer" ENABLE ROW LEVEL SECURITY;
