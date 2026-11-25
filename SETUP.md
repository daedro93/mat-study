# Mat Study setup (about 15 minutes, 3 steps)

You only do this once. Do one step at a time, and check each box when it's done.

---

## ☐ Step 1: Get a free web address (GitHub)

This is the "house" where the page will live.

1. Go to **github.com** and sign in (or make a free account).
2. Tell Claude your **GitHub username**.

Your page will live at: `https://daedro93.github.io/mat-study/`

---

## ☐ Step 2: Give the page a "key" to your OneDrive (Microsoft)

This tells Microsoft: "this page is allowed to **read** my OneDrive videos."

1. Go to **portal.azure.com** and sign in with the **same Microsoft account that has your OneDrive**.
   - If it asks you to create a free Azure account, do it. It's free. Microsoft may ask for a card to check you're a real person, but app registrations cost nothing.
2. In the top search bar, type **App registrations** and open it.
3. Click **+ New registration**.
4. Fill in:
   - **Name:** `Mat Study`
   - **Supported account types:** pick **Personal Microsoft accounts only**
   - **Redirect URI:** choose **Single-page application (SPA)**, then type
     `https://daedro93.github.io/mat-study/`
     (use your real username, and keep the `/` at the end)
5. Click **Register**.
6. On the next page, copy the **Application (client) ID** (it looks like `1a2b3c4d-...`) and send it to Claude.

You don't need to create any "secret" or password. This page doesn't use one.

---

## ☐ Step 3: First sign-in, then lock it to you

1. Open `https://daedro93.github.io/mat-study/` on your phone.
2. Tap **Sign in with Microsoft** and accept.
   It asks to "read your files" and "access its own app folder". That's expected.
3. The page shows an **owner code**. Tap **Copy code** and send it to Claude.
4. After Claude adds it, the page works **only for your account**.
5. Tap **Choose folder**, open your BJJ folder, and tap the green **Use** button.
6. In Chrome tap **⋮ → Add to Home screen**. Now it's an app icon. 🥋

---

## Why it's safe

- 🔒 **Only you:** the page checks the owner code and closes for anyone else. Even if someone else signed in, they'd only see *their own* OneDrive, never yours.
- 👀 **Read-only:** it can't change or delete your videos.
- 🚫 **No middleman:** there's no server. Your phone talks straight to Microsoft.
- 🗝️ **No secrets in the code:** the code is public, like a lock design. The key is your Microsoft sign-in.
- 📝 **Your notes:** bookmarks, notes and progress live on your phone, with a backup in OneDrive under **Apps › Mat Study**.

Note: for safety, the sign-in lasts about a day. When it runs out, tap **Sign in** again (usually one tap).
