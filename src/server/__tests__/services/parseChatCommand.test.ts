import { describe, it, expect } from 'vitest';
import { parseChatCommand, HELP_TEXT } from '../../services/chatCommands/parseChatCommand';

describe('parseChatCommand (Mjuzi typed commands)', () => {
  it.each([
    ['delete task 5', { kind: 'delete', row: 5 }],
    ['  Delete   Task 12 ', { kind: 'delete', row: 12 }],
    ['rename 5 to "Design"', { kind: 'rename', row: 5, name: 'Design' }],
    ['rename task 5 to “Sign-off review”', { kind: 'rename', row: 5, name: 'Sign-off review' }],
    ['link 5 to 7', { kind: 'link', from: 5, to: 7 }],
    ['link task 5 to task 7', { kind: 'link', from: 5, to: 7 }],
    ['unlink 5 from 7', { kind: 'unlink', from: 5, to: 7 }],
    ['task 5 status in progress', { kind: 'status', row: 5, status: 'in_progress' }],
    ['task 5 status Not Started', { kind: 'status', row: 5, status: 'pending' }],
    ['task 5 status done', { kind: 'status', row: 5, status: 'completed' }],
    ['task 5 priority high', { kind: 'priority', row: 5, priority: 'high' }],
    ['task 5 priority critical', { kind: 'priority', row: 5, priority: 'urgent' }],
    ['task 5 progress 60', { kind: 'progress', row: 5, percent: 60 }],
    ['task 5 progress 60%', { kind: 'progress', row: 5, percent: 60 }],
    ['task 5 start 2026-11-03', { kind: 'start', row: 5, date: '2026-11-03' }],
    ['task 5 end 2026-11-14', { kind: 'end', row: 5, date: '2026-11-14' }],
    ['add task "Training" 3 days', { kind: 'add', name: 'Training', days: 3 }],
    ['add task "Training" 1 day', { kind: 'add', name: 'Training', days: 1 }],
    ['add task "Training"', { kind: 'add', name: 'Training', days: undefined }],
    ['help', { kind: 'help' }],
    ['?', { kind: 'help' }],
    ['confirm delete 0b6a6a3e-1111-4222-8333-444455556666', { kind: 'confirm_delete', taskId: '0b6a6a3e-1111-4222-8333-444455556666' }],
  ])('%s is a command', (text, expected) => {
    expect(parseChatCommand(text)).toEqual(expected);
  });

  it.each([
    'get rid of the testing task',
    'delete task 5 please',
    'what is overdue?',
    'delete the task called Testing',
    'link all tasks',
    'clear all links',
    'cascade reschedule',
    'rename 5 to Design',
    'task five status done',
    'task 5 end date?',
    'task 5 start date',
    'task 5 end tomorrow',
    'task 5 status update please',
    'task 5 status?',
    'task 5 priority level?',
    'task 5 status what is it right now',
    '',
    '   ',
  ])('%s is not a command: it goes to Claude', (text) => {
    expect(parseChatCommand(text)).toBeNull();
  });

  it('a message that is not one line of a command is not one (a pasted list is never run)', () => {
    expect(parseChatCommand('delete task 5\ndelete task 6')).toBeNull();
    expect(parseChatCommand(`delete task 5 ${'x'.repeat(500)}`)).toBeNull();
  });

  it('says what is allowed when a value is wrong, still without Claude', () => {
    expect(parseChatCommand('task 5 status banana')).toMatchObject({ kind: 'invalid', message: expect.stringContaining('not a status') });
    expect(parseChatCommand('task 5 priority huge')).toMatchObject({ kind: 'invalid', message: expect.stringContaining('not a priority') });
    expect(parseChatCommand('task 5 progress 150')).toMatchObject({ kind: 'invalid', message: 'Progress is a number from 0 to 100.' });
    expect(parseChatCommand('task 5 start 2026-02-30')).toMatchObject({ kind: 'invalid', message: expect.stringContaining('not a date') });
    expect(parseChatCommand('task 5 end 14/11/2026')).toMatchObject({ kind: 'invalid', message: expect.stringContaining('not a date') });
    expect(parseChatCommand('add task "Training" 0 days')).toMatchObject({ kind: 'invalid' });
    expect(parseChatCommand('add task "Training" 5000 days')).toMatchObject({ kind: 'invalid' });
    expect(parseChatCommand(`rename 5 to "${'x'.repeat(300)}"`)).toMatchObject({ kind: 'invalid', message: expect.stringContaining('too long') });
  });

  it('the help text lists every command', () => {
    for (const word of ['delete task', 'rename', 'link', 'unlink', 'status', 'priority', 'progress', 'start', 'add task']) {
      expect(HELP_TEXT).toContain(word);
    }
  });
});
