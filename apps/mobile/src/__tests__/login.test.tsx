import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import Login from '../../app/login';
import { ApiError } from '../api/client';
import { authApi } from '../api/services';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../auth/AuthContext', () => ({ useAuth: () => ({ notice: null }) }));
jest.mock('../api/services', () => ({ authApi: { requestOtp: jest.fn() } }));

const requestOtp = jest.mocked(authApi.requestOtp);

describe('Login screen', () => {
  beforeEach(() => {
    mockPush.mockReset();
    requestOtp.mockReset();
  });

  it('shows the brand and keeps the button disabled until 10 digits are typed', async () => {
    await render(<Login />);
    expect(screen.getAllByRole('header')[0]).toHaveTextContent('UstaGO');
    expect(screen.getByText('İşini şimdi çözdür.')).toBeTruthy();
    expect(screen.getByTestId('send-code')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('phone-input'), '0500 000 00 01');
    expect(screen.getByTestId('phone-input')).toHaveDisplayValue('500 000 00 01');
    expect(screen.getByTestId('send-code')).toBeEnabled();
  });

  it('requests a code and opens the OTP screen', async () => {
    requestOtp.mockResolvedValue({
      phone: '+905000000001',
      purpose: 'REGISTER_OR_LOGIN',
      codeLength: 6,
      expiresAt: '2030-01-01T00:05:00.000Z',
      resendAvailableAt: '2030-01-01T00:01:00.000Z',
    });
    await render(<Login />);
    await fireEvent.changeText(screen.getByTestId('phone-input'), '5000000001');
    await fireEvent.press(screen.getByTestId('send-code'));
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(requestOtp).toHaveBeenCalledWith('+905000000001');
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/otp',
      params: { phone: '+905000000001', resendAt: '2030-01-01T00:01:00.000Z', length: '6' },
    });
  });

  it('rejects a number that is not a mobile number without calling the API', async () => {
    await render(<Login />);
    await fireEvent.changeText(screen.getByTestId('phone-input'), '2120000000');
    await fireEvent.press(screen.getByTestId('send-code'));
    expect(await screen.findByText(/Geçerli bir cep telefonu/)).toBeTruthy();
    expect(requestOtp).not.toHaveBeenCalled();
  });

  it('turns a rate limit into minutes the user can act on', async () => {
    requestOtp.mockRejectedValue(
      new ApiError(429, 'OTP_RATE_LIMITED', 'Çok sık istek.', { retryAfterSeconds: 150 }),
    );
    await render(<Login />);
    await fireEvent.changeText(screen.getByTestId('phone-input'), '5000000001');
    await fireEvent.press(screen.getByTestId('send-code'));
    expect(await screen.findByText(/3 dakika sonra tekrar deneyin/)).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
