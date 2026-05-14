# Changelog

## 1.4.0

### New features
- **Jira ticket sidebar** — click any Jira badge to open a sidebar with full ticket details: summary, status, resolution, type, priority, assignee, reporter, labels, epic, components, versions, fix versions, dates, and description. Renders Jira wiki markup — images, videos, links. Close with × or Escape.
- **Attachments in sidebar** — view images, videos, and files attached to Jira tickets directly in the sidebar. Images and videos open in a fullscreen lightbox, other files open in a new tab.
- **Jira badges on MR detail page** — Jira ticket status badges are shown in the MR title on the detail page. Click to open the sidebar with full ticket details.
- **Custom Jira ticket regex** — configurable regular expression for parsing ticket IDs from MR titles. Useful when your project uses non-standard ticket prefixes.
- **Change Jira status from sidebar** — transition buttons below the current status show only available workflow transitions. Change ticket status without leaving GitLab.
- **Change Jira assignee from sidebar** — click the assignee name to search and reassign. Autocomplete with avatars, searches only users assignable to the ticket. Unassign button to remove assignee.
- **Jira quick actions** — configure composite actions in settings: change status + assign user in one click. Buttons appear in the sidebar only when the target transition is available from the current status.
- **Issue type & priority icons** — show native Jira icons for issue type and priority next to status badges on MR list and detail pages. Enable in Jira settings.
- **Sprint field in sidebar** — displays the current sprint name in the Jira ticket sidebar.
- **Clickable Epic Link** — Epic Link in sidebar opens the epic in Jira in a new tab.

---

## 1.3.0

### New features
- **Jira integration** — shows Jira ticket statuses as colored badges on the MR list page. Parses ticket IDs (e.g. `CCS-1111`) from MR titles and fetches status via Jira REST API using session cookies. Color-coded: green (Done), blue (In Progress), purple (QA), yellow (In Review), gray (To Do). Skeleton loaders while fetching.
- **Copy MR from list** — copy button in the controls bar of each MR on the list page. Copies title + link to clipboard with one click. Always visible, icon turns green on success.
- **"Needs my review" toggle** — filter button on MR list page to show only MRs where you are assigned as a reviewer. Works via GitLab's `reviewer_username` parameter.
- **"Your review" badge** — scans first 10 comments of each MR for "Reviewer(s): @you" pattern and shows an orange badge. For teams that assign reviewers via comments instead of GitLab's built-in feature. Results cached for 5 min.

### Technical
- Uses `chrome.cookies` API for Jira auth (same session cookie approach as GitLab)
- Status caching (5 min TTL) to minimize API calls
- Sequential ticket fetching to avoid overloading Jira
- Added `cookies` permission and `optional_host_permissions` to manifest

---

## 1.2.10

### New features
- **Rebase** button — rebase branch without merging
- **Rebase + Version** button — rebase and bump version without merging
- **Copy MR** button — copy MR title and link to clipboard with one click
- **Dim Draft MRs** — visually dim Draft MRs on the merge requests list page
- **Highlight your MRs** — highlight your own MRs on the list page with a blue border
- **Skip confirmations** setting — disable all confirmation dialogs for one-click workflow
- **"Only mine"** toggle on MR list page — hide all MRs except yours


### Improvements
- New "MR list enhancements" settings section for list page UX features
- Current username detection via GitLab API with local caching
