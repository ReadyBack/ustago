import { fireEvent, render, screen } from '@testing-library/react-native';

import { jobListItemFixture } from '../test/fixtures';
import { ActiveJobCard } from './ActiveJobCard';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

describe('ActiveJobCard', () => {
  it('shows the customer status, the current total and opens the job', async () => {
    await render(<ActiveJobCard job={jobListItemFixture()} viewer="CUSTOMER" />);
    expect(screen.getByText('AKTİF İŞİNİZ')).toBeTruthy();
    expect(screen.getByText('Usta yolda')).toBeTruthy();
    expect(screen.getByText('₺2.700')).toBeTruthy();
    await fireEvent.press(screen.getByText('İŞİ GÖR'));
    expect(mockPush).toHaveBeenCalledWith('/job/job-1');
  });

  it('labels the provider card differently', async () => {
    await render(<ActiveJobCard job={jobListItemFixture()} viewer="PROVIDER" />);
    expect(screen.getByText('AKTİF İŞ')).toBeTruthy();
    expect(screen.getByText('İŞİ AÇ')).toBeTruthy();
  });
});
