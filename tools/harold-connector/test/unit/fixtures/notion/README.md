Notion API (version 2026-03-11) shapes for the Notion provider tests, written from the examples in the official
documentation (developers.notion.com/reference: page, property-object, query-a-data-source, post-search, webhooks,
webhooks-events-delivery; the 2025-09-03 and 2026-03-11 upgrade guides), fetched 2026-11-18. page.json is the
documentation's page example (ids, url, Status "Not started", Due date 2023-02-23, title "Bug bash") with the property
names of data-source.json and `in_trash` set to false; the webhook payloads are the documentation's page.created,
page.properties_updated and page.deleted examples, with data.parent carrying the data_source_id that API version
2025-09-03 adds. The status groups (To-do / In progress / Complete) follow the documented Status schema.
Not recorded from a live account: they prove the provider's logic against the documented shapes, not that the live
service matches them.

data-source-live.json and page-live.json are recorded from a live throwaway workspace (2026-11-18, ids replaced with
placeholders that keep the page's parent pointing at the data source): a new database's default Status property, a
Priority select with no options, and a page made by the provider. Also seen live: last_edited_time is rounded to the
minute; writing a select option name the select does not have adds the option; a data source query never returns
trashed pages, and trashing does not change last_edited_time.

The verification token in webhook-verification.json is a made-up placeholder (the documentation's own example looks like a real token and trips secret scanners).
