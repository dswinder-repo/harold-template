Todoist API v1 response shapes for the Todoist provider tests, written from the examples in the official
documentation (developer.todoist.com/api/v1: sync/tasks, sync/overview, tasks, projects, pagination, webhooks),
fetched 2026-11-18. Ids and values are the documentation's own where it gives them. Not recorded from a live
account: they prove the provider's logic against the documented shapes, not that the live service matches them.

sync-deleted-tombstone.json is recorded from a live throwaway account (2026-11-18, ids and the user id replaced): what
incremental sync returns for a deleted task. Not documented: content "", project_id a placeholder, updated_at null,
added_at at the epoch. Also seen live: GET /tasks/{id} returns a completed task (checked true) and answers 404 for a
deleted one; labels set on a task by name are not added to the personal label list (GET /labels stays empty); and an
unknown or malformed sync_token gets HTTP 200 with a full sync, not an error.
