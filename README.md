# Swineheadz Squares — reset/save race-condition fix

## What was wrong
Every save (reset, confirm-pending, draw numbers, score entry, etc.) writes to
storage, but the 4-second poll (`load()`) can have an older request already in
flight when that save lands. When the old, slower `load()` finally resolves,
it overwrites the fresh save with stale data — which is why "Reset" appeared
to work and then the old board came back a few seconds later.

## The fix
Two tiny additions to the `Board` component in your `.jsx` file:
1. A `stateVersionRef` counter that bumps the instant any `save()` starts.
2. `load()` checks that counter after its request resolves, and throws away
   its result if a save has started since it began.

No other logic changes — every write path (reset, confirm payment, draw
numbers, etc.) already goes through `save()`, so this one guard covers all of
them.

## How to apply it

### Option A — patch (recommended if you have git/patch locally)
From the root of your repo:
```bash
patch -p0 < swineheadz-squares-race-condition.patch
```
or
```bash
git apply swineheadz-squares-race-condition.patch
```
If your file isn't at the exact path the patch expects, open the `.patch`
file and adjust the `---`/`+++` lines, or just do the manual edit below —
it's the same three edits.

### Option B — manual edit (works from the GitHub web editor too)
Open your component file and make these three find-and-replace edits inside
the `Board` function:

**1. Add a version ref**, right after `savingRef`:
```diff
   const pollRef = useRef(null);
   const savingRef = useRef(false);
+  // Bumped every time a save() starts. Any load() whose response resolves
+  // after a newer save has begun is stale and must be discarded — otherwise
+  // a slow in-flight poll can silently overwrite a fresh reset/save with old data.
+  const stateVersionRef = useRef(0);
```

**2. Guard `load()`** so a stale response is dropped:
```diff
   const load = useCallback(
     async (silent) => {
+      const versionAtRequest = stateVersionRef.current;
       try {
         if (!silent) setLoading(true);
         const res = await window.storage.get(STORAGE_KEY, true);
+        // A save started (or is in progress) after this load began — its
+        // response is stale, so drop it instead of clobbering newer state.
+        if (savingRef.current || stateVersionRef.current !== versionAtRequest) {
+          return;
+        }
         if (res && res.value) {
```

**3. Bump the version at the start of `save()`**:
```diff
       try {
         savingRef.current = true;
+        // Bump immediately so any load() already in flight gets invalidated
+        // when it resolves, even if it resolves after this save finishes.
+        stateVersionRef.current += 1;
         if (!window.storage || typeof window.storage.set !== "function") {
```

That's it — same fix, no image data involved, so there's zero risk to your
logo/mascot assets.

## Why there's no full replacement file in this zip
Your component embeds large base64-encoded logo/mascot images inline. I
didn't want to retype ~60KB of base64 by hand and risk silently corrupting
those assets in a "drop-in" file, so this zip ships as a patch/diff against
your real file instead — apply it in place and your existing image data is
never touched.
