// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SWIPE, useSwipe } from './swipe';

type Point = readonly [x: number, y: number];

function Row({ onLeft, onRight }: { onLeft: () => void; onRight: () => void }) {
  const { handlers } = useSwipe({ onLeft, onRight });
  return <div data-testid="row" {...handlers} />;
}

function renderRow() {
  const onLeft = vi.fn();
  const onRight = vi.fn();
  render(<Row onLeft={onLeft} onRight={onRight} />);
  const row = screen.getByTestId('row');
  row.setPointerCapture = vi.fn(); // jsdom has none
  return { row, onLeft, onRight };
}

/** A finger going down at the origin, through each point, then lifting. */
function drag(row: HTMLElement, path: readonly Point[]): void {
  const pointer = { pointerId: 1, pointerType: 'touch' };
  fireEvent.pointerDown(row, { ...pointer, clientX: 0, clientY: 0 });
  for (const [clientX, clientY] of path) fireEvent.pointerMove(row, { ...pointer, clientX, clientY });
  fireEvent.pointerUp(row, pointer);
}

afterEach(cleanup);

describe('useSwipe', () => {
  it('runs the left action, and only that, on a swipe left past the threshold', () => {
    const { row, onLeft, onRight } = renderRow();

    drag(row, [[-SWIPE, 0]]);

    expect(onLeft).toHaveBeenCalledOnce();
    expect(onRight).not.toHaveBeenCalled();
  });

  it('runs the right action, and only that, on a swipe right past the threshold', () => {
    const { row, onLeft, onRight } = renderRow();

    drag(row, [[SWIPE, 0]]);

    expect(onRight).toHaveBeenCalledOnce();
    expect(onLeft).not.toHaveBeenCalled();
  });

  it('runs no action on a swipe left that stops short of the threshold', () => {
    const { row, onLeft, onRight } = renderRow();

    drag(row, [[-(SWIPE - 1), 0]]);

    expect(onLeft).not.toHaveBeenCalled();
    expect(onRight).not.toHaveBeenCalled();
  });

  it('runs no action on a swipe right that stops short of the threshold', () => {
    const { row, onLeft, onRight } = renderRow();

    drag(row, [[SWIPE - 1, 0]]);

    expect(onLeft).not.toHaveBeenCalled();
    expect(onRight).not.toHaveBeenCalled();
  });

  it.each([
    ['left', -1],
    ['right', 1],
  ])('runs no action on a mostly vertical drag leaning %s', (_lean, sign) => {
    const { row, onLeft, onRight } = renderRow();

    drag(row, [[sign * (SWIPE + 10), SWIPE + 60]]);

    expect(onLeft).not.toHaveBeenCalled();
    expect(onRight).not.toHaveBeenCalled();
  });

  it('keeps a drag that started vertical as a scroll when it turns sideways', () => {
    const { row, onLeft, onRight } = renderRow();

    drag(row, [
      [0, 20],
      [SWIPE + 10, 20],
    ]);

    expect(onLeft).not.toHaveBeenCalled();
    expect(onRight).not.toHaveBeenCalled();
  });
});
