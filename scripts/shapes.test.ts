import { describe, expect, it } from 'vitest';
import { costIds, shapesOf } from './shapes';

describe('shapesOf', () => {
  it('reads each kind of tag, ignoring ids and numbers', () => {
    expect(
      shapesOf(`
      <condition type="atLeast" value="3" field="selections" scope="force" childId="a1" includeChildSelections="true"/>
      <repeat value="2" field="selections" scope="b2" roundUp="true"></repeat>
      <constraint id="c" type="max" value="1" field="pts" scope="roster" percentValue="true"/>
      <modifier type="set" field="hidden" value="true"></modifier>
    `),
    ).toEqual([
      'condition atLeast selections force deep',
      'repeat selections id roundUp',
      'constraint max cost roster percent',
      'modifier set hidden',
    ]);
  });
  it('fills in the defaults the parser would use', () => {
    expect(shapesOf('<constraint type="min"/>')).toEqual(['constraint min selections parent']);
  });
  it('ignores wrappers and groups', () => {
    expect(shapesOf('<conditions><conditionGroup type="or"/></conditions><modifiers/><modifierGroup/>')).toEqual([]);
  });
  it('flags a modifier that reaches other entries', () => {
    expect(shapesOf('<modifier type="increment" field="abc" affects="profiles.Unit"/>')).toEqual([
      'modifier increment id affects',
    ]);
  });
  it('treats ids from a cost type declared elsewhere as costs', () => {
    const ids = costIds('<costTypes><costType name="x" id="c1"/></costTypes>');
    expect(ids).toEqual(['c1']);
    expect(shapesOf('<modifier type="set" field="c1"/>', ids)).toEqual(['modifier set cost']);
    expect(shapesOf('<modifier type="set" field="c1"/>')).toEqual(['modifier set id']);
  });
});
