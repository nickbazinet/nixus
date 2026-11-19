import type Stripe from "stripe";

/*
 * In-memory stand-in for the Stripe SDK. No test in this package reaches the
 * network, and there is no Stripe credential available to one: every behaviour
 * under test - signature verification, convergence, the catalog read, the
 * Checkout parameter set, promotion-code resolution - is exercised against this.
 *
 * The builders below construct only the fields this service reads, and cast once
 * at the boundary. That is deliberate: a hand-written literal of the real
 * `Stripe.Subscription` would be hundreds of fields of noise, and the fields that
 * matter would be invisible among them.
 */

export interface FakeStripeCall {
  readonly method: string;
  readonly params: unknown;
  readonly options?: unknown;
}

export function stripeProduct(args: {
  readonly id?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}): Stripe.Product {
  return {
    id: args.id ?? "prod_test",
    object: "product",
    active: true,
    deleted: undefined,
    metadata: { ...(args.metadata ?? {}) },
  } as unknown as Stripe.Product;
}

export function stripePrice(args: {
  readonly id?: string;
  readonly lookupKey: string | null;
  readonly unitAmount?: number | null;
  readonly currency?: string;
  readonly interval?: string | null;
  readonly active?: boolean;
  /** A bare id reproduces the UNEXPANDED case the narrowing helper must refuse. */
  readonly product: Stripe.Product | string;
}): Stripe.Price {
  return {
    id: args.id ?? "price_test",
    object: "price",
    active: args.active ?? true,
    currency: args.currency ?? "cad",
    lookup_key: args.lookupKey,
    unit_amount: args.unitAmount === undefined ? 999 : args.unitAmount,
    recurring:
      args.interval === null ? null : { interval: args.interval ?? "month" },
    product: args.product,
  } as unknown as Stripe.Price;
}

export function stripeSubscription(args: {
  readonly id?: string;
  readonly customer?: string;
  readonly status: string;
  /** Unix seconds, ONE PER ITEM - `current_period_end` is not on the
   * subscription object. An empty array is the malformed case. */
  readonly periodEnds: readonly number[];
  readonly product: Stripe.Product;
  readonly metadata?: Readonly<Record<string, string>>;
}): Stripe.Subscription {
  return {
    id: args.id ?? "sub_test",
    object: "subscription",
    customer: args.customer ?? "cus_test",
    status: args.status,
    metadata: { ...(args.metadata ?? {}) },
    items: {
      object: "list",
      data: args.periodEnds.map((end, index) => ({
        id: `si_test_${index}`,
        object: "subscription_item",
        current_period_end: end,
        price: stripePrice({
          id: `price_item_${index}`,
          lookupKey: "classic_monthly_cad",
          product: args.product,
        }),
      })),
    },
  } as unknown as Stripe.Subscription;
}

export function stripeEvent(args: {
  readonly id?: string;
  readonly type: string;
  readonly created: number;
  readonly livemode?: boolean;
  readonly object: unknown;
}): Stripe.Event {
  return {
    id: args.id ?? "evt_test",
    object: "event",
    type: args.type,
    created: args.created,
    livemode: args.livemode ?? false,
    data: { object: args.object },
  } as unknown as Stripe.Event;
}

export function subscriptionEventObject(
  subscription: Stripe.Subscription,
): unknown {
  return subscription;
}

export function invoiceEventObject(subscriptionId: string | null): unknown {
  return {
    object: "invoice",
    id: "in_test",
    parent:
      subscriptionId === null
        ? null
        : { subscription_details: { subscription: subscriptionId } },
  };
}

export function checkoutSessionEventObject(args: {
  readonly subscription: string | null;
  readonly clientReferenceId?: string | null;
}): unknown {
  return {
    object: "checkout.session",
    id: "cs_test",
    subscription: args.subscription,
    client_reference_id: args.clientReferenceId ?? null,
  };
}

export class FakeStripe {
  readonly calls: FakeStripeCall[] = [];

  private prices: Stripe.Price[] = [];
  private subscriptions: Stripe.Subscription[] = [];
  private promotionCodeIds = new Map<string, string>();
  private verified: Stripe.Event | Error = new Error("no event configured");
  private sessionUrl: string | null = "https://checkout.stripe.com/c/pay/cs_test";
  private portalUrl = "https://billing.stripe.com/p/session/test";
  private createdCustomerId = "cus_created";
  private failures = new Map<string, Error>();

  seedPrices(prices: readonly Stripe.Price[]): this {
    this.prices = [...prices];
    return this;
  }

  seedSubscriptions(subscriptions: readonly Stripe.Subscription[]): this {
    this.subscriptions = [...subscriptions];
    return this;
  }

  /** The Dashboard-facing code mapped to the PromotionCode object id, which is
   * what the `discounts` form takes. */
  seedPromotionCode(code: string, id: string): this {
    this.promotionCodeIds.set(code.toLowerCase(), id);
    return this;
  }

  seedVerifiedEvent(event: Stripe.Event | Error): this {
    this.verified = event;
    return this;
  }

  seedSessionUrl(url: string | null): this {
    this.sessionUrl = url;
    return this;
  }

  seedCreatedCustomerId(id: string): this {
    this.createdCustomerId = id;
    return this;
  }

  failOn(method: string, error: Error): this {
    this.failures.set(method, error);
    return this;
  }

  paramsOf(method: string): unknown {
    return this.calls.find((call) => call.method === method)?.params;
  }

  optionsOf(method: string): unknown {
    return this.calls.find((call) => call.method === method)?.options;
  }

  countOf(method: string): number {
    return this.calls.filter((call) => call.method === method).length;
  }

  private record(method: string, params: unknown, options?: unknown): void {
    this.calls.push({ method, params, options });
    const queued = this.failures.get(method);
    if (queued) throw queued;
  }

  /* Arrow properties throughout, so `this` is captured lexically from the method
   * body - the returned object is handed to code that destructures methods off
   * it, and a `function` member would lose the instance. */
  asStripe(): Stripe {
    return {
      webhooks: {
        constructEvent: (
          payload: unknown,
          header: unknown,
          secret: unknown,
          tolerance?: unknown,
        ): Stripe.Event => {
          this.record("webhooks.constructEvent", {
            payload,
            header,
            secret,
            tolerance,
          });
          if (this.verified instanceof Error) throw this.verified;
          return this.verified;
        },
      },
      prices: {
        list: async (params: unknown): Promise<{ data: Stripe.Price[] }> => {
          this.record("prices.list", params);
          return { data: [...this.prices] };
        },
      },
      promotionCodes: {
        list: async (params: {
          code?: string;
        }): Promise<{ data: { id: string }[] }> => {
          this.record("promotionCodes.list", params);
          const id = this.promotionCodeIds.get((params.code ?? "").toLowerCase());
          return { data: id === undefined ? [] : [{ id }] };
        },
      },
      subscriptions: {
        retrieve: async (
          id: string,
          params: unknown,
        ): Promise<Stripe.Subscription> => {
          this.record("subscriptions.retrieve", { id, params });
          const found = this.subscriptions.find(
            (subscription) => subscription.id === id,
          );
          if (found === undefined) {
            throw new Error(`no such subscription: ${id}`);
          }
          return found;
        },
        list: async (params: {
          customer?: string;
        }): Promise<{ data: Stripe.Subscription[] }> => {
          this.record("subscriptions.list", params);
          return {
            data: this.subscriptions.filter(
              (subscription) => subscription.customer === params.customer,
            ),
          };
        },
      },
      customers: {
        create: async (
          params: unknown,
          options: unknown,
        ): Promise<{ id: string }> => {
          this.record("customers.create", params, options);
          return { id: this.createdCustomerId };
        },
      },
      checkout: {
        sessions: {
          create: async (params: unknown): Promise<{ url: string | null }> => {
            this.record("checkout.sessions.create", params);
            return { url: this.sessionUrl };
          },
        },
      },
      billingPortal: {
        sessions: {
          create: async (params: unknown): Promise<{ url: string }> => {
            this.record("billingPortal.sessions.create", params);
            return { url: this.portalUrl };
          },
        },
      },
    } as unknown as Stripe;
  }
}
