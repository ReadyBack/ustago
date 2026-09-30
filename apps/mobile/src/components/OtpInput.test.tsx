import { fireEvent, render, screen } from '@testing-library/react-native';

import { OtpInput } from './OtpInput';

describe('OtpInput', () => {
  it('keeps digits only and reports a complete code once', async () => {
    const onChange = jest.fn();
    const onComplete = jest.fn();
    await render(<OtpInput value="" onChange={onChange} onComplete={onComplete} />);
    const input = screen.getByLabelText('Doğrulama kodu');

    await fireEvent.changeText(input, '12a3');
    expect(onChange).toHaveBeenLastCalledWith('123');
    expect(onComplete).not.toHaveBeenCalled();

    await fireEvent.changeText(input, '123 456 789');
    expect(onChange).toHaveBeenLastCalledWith('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('shows each typed digit in its own box', async () => {
    await render(<OtpInput value="42" onChange={() => undefined} />);
    expect(screen.getByText('4', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('2', { includeHiddenElements: true })).toBeTruthy();
  });
});
