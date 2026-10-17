declare namespace chrome {
  namespace action {
    function openPopup(callback?: () => void): void;
  }

  namespace runtime {
    const lastError: { message?: string } | undefined;
    function sendMessage<T = unknown>(message: unknown): Promise<T>;
    const onMessage: {
      addListener(
        callback: (
          message: any,
          sender: { tab?: tabs.Tab },
          sendResponse: (response?: any) => void
        ) => boolean | void
      ): void;
    };
  }

  namespace storage {
    const local: {
      get<T = Record<string, unknown>>(keys?: string | string[] | Record<string, unknown> | null): Promise<T>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
    }

    function query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]>;
    function sendMessage<T = unknown>(tabId: number, message: unknown): Promise<T>;
  }
}
