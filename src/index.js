import { nanoid } from 'nanoid';

export class ExecutableFlow {
  #db;

  constructor(db) {
    this.#db = db;
  }

  async execute(genFn, id = nanoid(), input = {}) {
    const saved = await this.#db?.get?.(id);
    const step = saved?.step ?? 0;

    let currentStep = 0;
    let gen = genFn(input);
    let iter = gen.next();

    try {
      while (!iter.done) {
        const { __tool, __save } = iter.value;

        if (__save) {
          await this.#db?.set?.(id, { step: currentStep });
          globalThis.__resume?.(id).catch(() => {});
          throw Error('$pause$');
        }

        if (__tool) {
          const [cat, n, i] = __tool;

          let result;
          if (currentStep < step) {
            // Resume mode: load result from DB
            result = await this.#db?.getResult?.(id, currentStep);
          } else {
            // Execution mode: call tool and save result
            try {
              result = await globalThis.__call?.(cat, n, i);
              await this.#db?.setResult?.(id, currentStep, result);
            } catch (e) {
              result = { __error: e.message };
              await this.#db?.setResult?.(id, currentStep, result);
            }
          }

          currentStep++;
          iter = gen.next(result);
        } else {
          throw Error('Invalid yield');
        }
      }

      await this.#db?.delete?.(id);
      return iter.value;
    } catch (e) {
      if (e.message === '$pause$') return { paused: id, step };
      throw e;
    }
  }
}

globalThis.__call = async (cat, n, i) => {
  throw Error('__call not configured');
};

globalThis.__resume = async (id) => {
  throw Error('__resume not configured');
};

export const createFlowExecutor = (db) => new ExecutableFlow(db);
