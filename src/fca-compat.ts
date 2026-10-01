function extractEvents(
  packet: any,
  botID: string | null
): any[] {
  const events: any[] = [];

  function addItem(
    item: any,
    threadHint: any = null
  ): void {
    if (
      !item ||
      typeof item !== "object"
    ) {
      return;
    }

    /*
     * deltaNewMessage / deltaReaction /
     * deltaUnsend style packet.
     */
    if (
      item.delta_type &&
      item.message
    ) {
      const raw =
        item.message;

      const thread = {
        thread_id:
          raw.thread_id ||
          threadHint?.thread_id,

        users:
          raw.users ||
          threadHint?.users,

        is_group:
          raw.is_group ??
          threadHint?.is_group
      };

      const event =
        normalizeItem(
          raw,
          thread,
          botID || undefined
        );

      const itemType =
        String(
          raw.item_type || ""
        ).toLowerCase();

      if (
        /reaction/.test(
          itemType
        ) ||
        item.delta_type ===
          "deltaReaction"
      ) {
        event.type =
          "message_reaction";
      }
      else if (
        /unsend|delete/.test(
          itemType
        ) ||
        /Unsend|Delete/i.test(
          String(
            item.delta_type
          )
        )
      ) {
        event.type =
          "message_unsend";
      }
      else {
        event.type =
          "message";
      }

      events.push(event);
      return;
    }

    /*
     * Patch-style realtime packets:
     *
     * {
     *   op: "add",
     *   path: "/direct_v2/threads/<thread>/items/<item>",
     *   value: { ... }
     * }
     */
    if (
      item.op &&
      item.path &&
      item.value &&
      typeof item.value === "object"
    ) {
      const path =
        String(
          item.path
        );

      const match =
        path.match(
          /\/threads\/([^/]+)\/items\/([^/]+)/
        );

      const threadID =
        match?.[1] ||
        item.value.thread_id ||
        threadHint?.thread_id ||
        "";

      const raw = {
        ...item.value,
        thread_id:
          item.value.thread_id ||
          threadID,

        item_id:
          item.value.item_id ||
          match?.[2]
      };

      const thread = {
        thread_id:
          threadID,

        users:
          raw.users ||
          threadHint?.users ||
          [],

        is_group:
          raw.is_group ??
          threadHint?.is_group
      };

      const event =
        normalizeItem(
          raw,
          thread,
          botID || undefined
        );

      const type =
        String(
          raw.item_type ||
          raw.type ||
          ""
        ).toLowerCase();

      if (
        /reaction/.test(type)
      ) {
        event.type =
          "message_reaction";
      }
      else if (
        /unsend|delete/.test(type)
      ) {
        event.type =
          "message_unsend";
      }
      else {
        event.type =
          "message";
      }

      events.push(event);
      return;
    }

    /*
     * Direct item packet.
     */
    if (
      item.path &&
      item.item_id
    ) {
      events.push(
        normalizeItem(
          item,
          item,
          botID || undefined
        )
      );

      return;
    }

    /*
     * Simple normalized message.
     */
    if (
      item.thread_id &&
      (
        item.text != null ||
        item.item_type
      )
    ) {
      events.push(
        normalizeItem(
          item,
          item,
          botID || undefined
        )
      );

      return;
    }

    /*
     * Nested patch / data array.
     */
    if (
      Array.isArray(
        item.data
      )
    ) {
      for (
        const child of
        item.data
      ) {
        addItem(
          child,
          threadHint
        );
      }
    }
  }

  function walk(
    value: any,
    threadHint: any = null
  ): void {
    if (
      value == null
    ) {
      return;
    }

    if (
      Array.isArray(value)
    ) {
      for (
        const item of value
      ) {
        walk(
          item,
          threadHint
        );
      }

      return;
    }

    if (
      typeof value !==
      "object"
    ) {
      return;
    }

    /*
     * Common MQTT wrapper.
     */
    if (
      value.data !== undefined
    ) {
      if (
        Array.isArray(
          value.data
        )
      ) {
        for (
          const child of
          value.data
        ) {
          walk(
            child,
            threadHint
          );
        }
      }
      else {
        walk(
          value.data,
          threadHint
        );
      }
    }

    /*
     * Direct message wrapper.
     */
    if (
      value.message &&
      typeof value.message === "object"
    ) {
      if (
        value.delta_type
      ) {
        addItem(
          value,
          threadHint
        );
      }
      else {
        walk(
          value.message,
          threadHint
        );
      }
    }

    /*
     * Process this object itself.
     */
    addItem(
      value,
      threadHint
    );
  }

  walk(packet);

  /*
   * Remove accidental duplicates.
   */
  const seen =
    new Set<string>();

  return events.filter(
    event => {
      const key =
        [
          event.type,
          event.threadID,
          event.messageID ||
            event.itemID ||
            "",
          event.senderID ||
            event.userID ||
            ""
        ].join(":");

      if (
        seen.has(key)
      ) {
        return false;
      }

      seen.add(key);
      return true;
    }
  );
}
