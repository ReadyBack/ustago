import { render, screen } from '@testing-library/react-native';

import { HomeScreen } from './HomeScreen';

describe('HomeScreen', () => {
  it('renders the brand header', async () => {
    await render(<HomeScreen />);
    expect(screen.getByRole('header')).toHaveTextContent('UstaGO');
  });
});
