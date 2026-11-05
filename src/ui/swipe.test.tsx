// @vitest-environment jsdom
import { render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { drag } from '../test/screen';
import { SWIPE, useSwipe } from './swipe';

function Row({ onLeft, onRight }: { onLeft: () => void; onRight: () => void }) {
  const { handlers } = useSwipe({ onLeft, onRight });
  return <div data-testid="row" {...handlers} />;
}

function renderRow() {
  const onLeft = vi.fn();
  const onRight = vi.fn();
  render(<Row onLeft={onLeft} onRight={onRight} />);
  const row = screen.getByTestId('row');
  return { row, onLeft, onRight };
}

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
