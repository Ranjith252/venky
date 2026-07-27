-- Create a table for the shared quiz/app state
create table if not exists app_state (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Optional: insert the initial shared record
insert into app_state (id, payload)
values (
  'shared_state',
  '{"permittedPhones":[],"permissionRequests":[],"users":{},"questions":[],"exams":{},"adminPassword":"","quizTitle":"My Quiz","studyNotes":[],"studySubjects":[],"notifications":[],"notificationRecipients":[],"desktopNotificationsEnabled":false,"videos":[]}'::jsonb
)
on conflict (id) do nothing;
