import * as assert from 'node:assert/strict';
import { LspRestartBudget } from '../lspRestartBudget';

describe('LspRestartBudget', () => {
    it('allows up to maxRestarts within the window, then refuses', () => {
        let now = 1000;
        const budget = new LspRestartBudget(3, 60_000, () => now);
        assert.equal(budget.shouldRestart(), true, '1st');
        assert.equal(budget.shouldRestart(), true, '2nd');
        assert.equal(budget.shouldRestart(), true, '3rd');
        assert.equal(budget.shouldRestart(), false, '4th exceeds budget');
        assert.equal(budget.shouldRestart(), false, 'stays refused');
        assert.equal(budget.count, 5);
    });

    it('resets the counter once the window elapses', () => {
        let now = 0;
        const budget = new LspRestartBudget(2, 1000, () => now);
        assert.equal(budget.shouldRestart(), true);
        assert.equal(budget.shouldRestart(), true);
        assert.equal(budget.shouldRestart(), false); // budget used up
        now += 1001; // window elapses
        assert.equal(budget.shouldRestart(), true, 'budget refreshed after window');
        assert.equal(budget.count, 1);
    });

    it('does not reset while still inside the window', () => {
        let now = 0;
        const budget = new LspRestartBudget(1, 1000, () => now);
        assert.equal(budget.shouldRestart(), true);
        now += 999;
        assert.equal(budget.shouldRestart(), false, 'still within window, budget exhausted');
    });
});
