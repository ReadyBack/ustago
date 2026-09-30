import { fireEvent, render, screen } from '@testing-library/react-native';

import { StarInput, Stars, starsLabel } from './StarRating';

describe('StarRating', () => {
  it('reads as "5 üzerinden N yıldız"', async () => {
    expect(starsLabel(4)).toBe('5 üzerinden 4 yıldız');
    await render(<Stars value={4.6} />);
    expect(screen.getByLabelText('5 üzerinden 4.6 yıldız')).toHaveTextContent('★★★★★');
  });

  it('rates by tapping a star and by the adjustable accessibility actions', async () => {
    const onChange = jest.fn();
    await render(<StarInput testID="r" label="Genel puan" value={3} onChange={onChange} />);
    await fireEvent.press(screen.getByTestId('r-5'));
    expect(onChange).toHaveBeenLastCalledWith(5);

    const control = screen.getByTestId('r');
    expect(control.props.accessibilityValue).toEqual({ text: '5 üzerinden 3 yıldız' });
    await fireEvent(control, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onChange).toHaveBeenLastCalledWith(4);
    await fireEvent(control, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it('says so when no rating was given yet', async () => {
    await render(<StarInput testID="r" label="İletişim" value={null} onChange={() => undefined} />);
    expect(screen.getByTestId('r').props.accessibilityValue).toEqual({ text: 'Puan verilmedi' });
  });
});
