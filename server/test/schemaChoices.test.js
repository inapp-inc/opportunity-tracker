import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSchemaChoiceFieldType,
  validateChoiceValue,
  schemaKeyToSnakeColumn,
} from '../src/schemaChoices.js';

test('isSchemaChoiceFieldType recognizes lookup and select types', () => {
  assert.equal(isSchemaChoiceFieldType('lookup_select'), true);
  assert.equal(isSchemaChoiceFieldType('text'), false);
});

test('validateChoiceValue accepts values from allowed options', () => {
  assert.equal(validateChoiceValue('status', 'Win', ['Open', 'Win', 'Loss']), '');
  assert.equal(validateChoiceValue('status', 'Bad', ['Open', 'Win']), 'invalid status: Bad');
});

test('validateChoiceValue skips empty when options exist', () => {
  assert.equal(validateChoiceValue('status', '', ['Open']), '');
});

test('validateChoiceValue allows any value when no options configured', () => {
  assert.equal(validateChoiceValue('status', 'Anything', []), '');
});

test('schemaKeyToSnakeColumn converts camelCase keys', () => {
  assert.equal(schemaKeyToSnakeColumn('winOrLoss'), 'win_or_loss');
  assert.equal(schemaKeyToSnakeColumn('prospectType'), 'prospect_type');
});
