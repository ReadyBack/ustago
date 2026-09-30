import { act, renderHook } from '@testing-library/react-native';

import { ApiError } from '../api/client';
import { useSubmit } from './useSubmit';

describe('useSubmit', () => {
  it('ignores a second tap while the first one runs', async () => {
    let finish: (value: string) => void = () => undefined;
    const action = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = await renderHook(() => useSubmit(action));
    let first: Promise<string | undefined> = Promise.resolve(undefined);
    await act(async () => {
      first = result.current.submit();
      await result.current.submit();
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);
    await act(async () => {
      finish('ok');
      await first;
    });
    expect(result.current.busy).toBe(false);
  });

  it('shows the server message on failure', async () => {
    const { result } = await renderHook(() =>
      useSubmit(async () => {
        throw new ApiError(409, 'QUOTE_CONFLICT', 'Teklif güncellendi, lütfen yenileyin.');
      }),
    );
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.error).toBe('Teklif güncellendi, lütfen yenileyin.');
  });
});
