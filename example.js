import { createFlowExecutor } from './src/index.js';

// Storage with separate result handling (e.g., large objects in separate table)
const state = new Map();
const results = new Map();

const storage = {
  get: (id) => Promise.resolve(state.get(id)),
  set: (id, data) => { state.set(id, data); return Promise.resolve(); },
  delete: (id) => { state.delete(id); results.delete(id); return Promise.resolve(); },

  getResult: (id, step) => Promise.resolve(results.get(`${id}:${step}`)),
  setResult: (id, step, data) => {
    results.set(`${id}:${step}`, data);
    return Promise.resolve();
  }
};

const flow = createFlowExecutor(storage);

// Generator with many tool calls and large data
function* workflow(input) {
  const user = yield { __tool: ['api', 'user', { id: input.userId }] };
  const posts = yield { __tool: ['api', 'posts', { uid: user.id }] };
  const comments = yield { __tool: ['api', 'comments', { postIds: posts.map(p => p.id) }] };
  const likes = yield { __tool: ['api', 'likes', { commentIds: comments.map(c => c.id) }] };

  // Local variables kept in generator closure, not in memory cache
  return {
    user,
    postsCount: posts.length,
    commentsCount: comments.length,
    likesCount: likes.length
  };
}

globalThis.__call = async (cat, n, i) => {
  const mocks = {
    user: { id: 1, name: 'Alice' },
    posts: [{ id: 101 }, { id: 102 }],
    comments: [{ id: 1001 }, { id: 1002 }, { id: 1003 }],
    likes: [{ id: 10001 }, { id: 10002 }, { id: 10003 }]
  };
  console.log(`[call] ${cat}/${n}`);
  return mocks[n];
};

globalThis.__resume = async (id) => {
  console.log(`[saved to db] → HTTP /resume/${id}`);
};

(async () => {
  // First call - runs until tool call 1, pauses
  console.log('=== First call ===');
  const r1 = await flow.execute(workflow, 'flow-1', { userId: 1 });
  console.log('Paused:', r1);
  console.log('State in DB:', state.get('flow-1'));
  console.log('Memory used: only current generator scope\n');

  // Resume - re-runs generator, feeds cached results, continues
  console.log('=== Resume call ===');
  const r2 = await flow.execute(workflow, 'flow-1', { userId: 1 });
  console.log('Final result:', r2);
  console.log('State cleaned:', !state.has('flow-1'));
})();
