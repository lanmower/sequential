# Sequential

Elegant pause/resume for edge functions. Save to DB, exit, resume on HTTP callback.

## The Pattern

```
Edge Function                     HTTP Callback
─────────────                     ─────────────
[run generator]
[hit tool call 1]
  ├─ save step to DB
  ├─ fire HTTP /resume (non-blocking)
  └─ exit cleanly
                                 [resume same generator]
                                 [re-run, cached results for 0..n]
                                 [hit tool call n+1]
                                   └─ repeat
```

## Usage

Users write a generator function:

```javascript
import { createFlowExecutor } from 'sequential';

const flow = createFlowExecutor(db);

function* workflow(input) {
  const user = yield { __tool: ['api', 'user', { id: input.userId }] };
  const posts = yield { __tool: ['api', 'posts', { uid: user.id }] };
  const comments = yield { __tool: ['api', 'comments', { postIds: posts.map(p => p.id) }] };

  // All locals (user, posts, comments) in closure, not in memory cache
  return { user, posts, comments };
}

const result = await flow.execute(workflow, 'exec-1', { userId: 123 });
// => { paused: 'exec-1' } if paused at tool call
// => { user, posts, comments } if completed
```

## Architecture

### Why Generators?

- **Natural locals**: Variables stay in generator closure
- **Resumable**: `.next(value)` resumes exactly where yielded
- **No serialization needed**: Load gen from function source, feed cached results
- **Cross-process safe**: Each invocation is independent

### Memory Efficiency

Results are saved separately to DB, not kept in memory:

```javascript
const storage = {
  get(id) { return db.getState(id); },
  set(id, data) { return db.setState(id, data); },
  delete(id) { return db.deleteAll(id); },

  getResult(id, step) { return db.getResult(id, step); },
  setResult(id, step, data) { return db.saveResult(id, step, data); }
};
```

This means:
- ✅ Can run 1000-step workflows
- ✅ Each result (even 100MB) goes straight to DB
- ✅ Only current generator scope in memory
- ✅ No buildup of cache

### Error Handling

Tool errors are captured and returned as `{ __error: message }`:

```javascript
function* workflow(input) {
  const result = yield { __tool: ['api', 'flaky', {}] };

  if (result.__error) {
    return { failed: true, reason: result.__error };
  }

  // continue...
}
```

## API

### ExecutableFlow

```javascript
const flow = createFlowExecutor(storage);

await flow.execute(genFn, id?, input?)
// Returns: { paused: id, step } | result value
```

**Generator yields:**

```javascript
yield { __tool: [category, name, input] }  // Call tool
yield { __save: true }                     // Explicit save point
```

**Global hooks:**

```javascript
globalThis.__call = async (category, name, input) => { ... };
globalThis.__resume = async (id) => {
  // Fire HTTP request to /resume/:id (non-blocking)
};
```

## Storage Interface

Implement your storage backend:

```javascript
{
  // State: which step we're at
  get(id) { return Promise<{step}>; },
  set(id, {step}) { return Promise.resolve(); },
  delete(id) { return Promise.resolve(); },

  // Results: tool call outputs (separate, loadable by step)
  getResult(id, step) { return Promise<data>; },
  setResult(id, step, data) { return Promise.resolve(); }
}
```

Examples:
- **Postgres**: results in JSONB column, state in metadata
- **Redis**: results as `exec:{id}:{step}`, state as `exec:{id}`
- **Firestore**: docs per execution, collections per step
- **S3**: `exec/{id}/step-{n}.json` + metadata object

## Example: Postgres

```javascript
const storage = {
  async get(id) {
    return db.one('SELECT step FROM executions WHERE id=$1', [id]);
  },
  async set(id, {step}) {
    await db.none('UPDATE executions SET step=$1 WHERE id=$2', [step, id]);
  },
  async delete(id) {
    await db.none('DELETE FROM executions WHERE id=$1', [id]);
    await db.none('DELETE FROM results WHERE exec_id=$1', [id]);
  },
  async getResult(id, step) {
    const row = await db.one('SELECT data FROM results WHERE exec_id=$1 AND step=$2', [id, step]);
    return row?.data;
  },
  async setResult(id, step, data) {
    await db.none('INSERT INTO results (exec_id, step, data) VALUES ($1, $2, $3)', [id, step, JSON.stringify(data)]);
  }
};
```

## Size

- **70 lines** core executor
- **1 dependency** (nanoid)
- **0 bloat**

## Node v23 Features Used

- Private fields (`#db`)
- Optional chaining (`?.`)
- Nullish coalescing (`??`)
- Generators + `yield`
- Destructuring + defaults
