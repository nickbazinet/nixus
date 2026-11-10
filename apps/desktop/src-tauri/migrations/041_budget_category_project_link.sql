-- The savings project a budget category stands for. NULL is the ordinary state: a regular spending
-- category. A linked category is not an expense category — its progress is the month's project
-- contributions, and its target is computed from the project when the project has a target date.
--
-- SET NULL and not CASCADE: deleting a project must not silently remove a budget line's history; the
-- line simply stops being linked. ADD COLUMN can carry a REFERENCES clause only because the default
-- is NULL, which this is.
--
-- No unique index on `project_id`: sync apply can legitimately produce two linked categories for
-- one project, and a constraint would make that apply fail. The command layer refuses a second
-- active link instead, and readers treat the lowest id as the link.
ALTER TABLE budget_categories
    ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX idx_budget_categories_project_id ON budget_categories(project_id);
