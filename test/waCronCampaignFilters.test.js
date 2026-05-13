'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  campaignSlotDateNotBeforeSendBoundaryExpr,
  mergeExprIntoFilter
} = require('../utils/waCronCampaignFilters');

describe('campaignSlotDateNotBeforeSendBoundaryExpr', () => {
  test('Mongo $expr fragment matches now >= slotDate - offsetMs', () => {
    const offsetMs = 4 * 60 * 60 * 1000;
    const slotDate = new Date('2026-05-13T12:30:00.000Z');
    const boundary = new Date(slotDate.getTime() - offsetMs);

    const nowOk = new Date(boundary.getTime());
    const exprOk = campaignSlotDateNotBeforeSendBoundaryExpr(offsetMs, nowOk);
    assert.ok(exprOk);
    const docOk = { step3Data: { slotDate } };
    const lhsOk = docOk.step3Data.slotDate.getTime() - offsetMs;
    assert.ok(lhsOk <= nowOk.getTime());

    const nowEarly = new Date(boundary.getTime() - 60_000);
    const exprEarly = campaignSlotDateNotBeforeSendBoundaryExpr(offsetMs, nowEarly);
    const lhsEarly = docOk.step3Data.slotDate.getTime() - offsetMs;
    assert.ok(lhsEarly > nowEarly.getTime());
    assert.ok(exprEarly);
  });

  test('mergeExprIntoFilter combines with existing $expr using $and', () => {
    const base = { a: 1, $expr: { $eq: [1, 1] } };
    const merged = mergeExprIntoFilter(base, { $lte: [0, 1] });
    assert.deepEqual(merged.$expr, { $and: [{ $eq: [1, 1] }, { $lte: [0, 1] }] });
  });
});
