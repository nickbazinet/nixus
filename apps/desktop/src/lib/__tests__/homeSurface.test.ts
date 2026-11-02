import { describe, expect, it } from "vitest";
import i18n from "i18next";
import en from "@/locales/en.json";
import { describeBindingScope, describeHomeChange } from "@/lib/homeSurface";

await i18n.init({ lng: "en", resources: { en: { translation: en } }, keySeparator: false, nsSeparator: false });
const t = i18n.t.bind(i18n);

describe("Home change card wording", () => {
  /* The reported scenario: a card for "last month" must say last month, so a wrong period is caught
   * before it is confirmed rather than after. */
  it("names the period and category a binding asks for", () => {
    expect(describeBindingScope({ months: 1, months_ago: 1 }, t)).toEqual(["last month"]);
    expect(describeBindingScope({ months: 1, months_ago: 0 }, t)).toEqual(["this month"]);
    expect(describeBindingScope({ months: 6, months_ago: 0 }, t)).toEqual(["last 6 months"]);
    expect(describeBindingScope({ months: 3, months_ago: 2 }, t)).toEqual(["3 months ending 2 months ago"]);
    expect(describeBindingScope({ months_ago: 1 }, t)).toEqual(["last month"]);
    expect(describeBindingScope({ months: 3, category: "groceries" }, t)).toEqual(["last 3 months", "groceries"]);
    expect(describeBindingScope({}, t)).toEqual([]);
  });

  it("puts the scope beside the data source on the card", () => {
    const card = describeHomeChange(
      {
        op: "modify",
        widget_id: "w_1",
        widget: {
          component: "PieChart",
          title: "Spending by Category – Last Month",
          dataBinding: { source: "expenses_by_category", params: { months: 1, months_ago: 1, limit: 8 } },
        },
      },
      t
    );
    expect(card.details).toEqual([{ field: "Pie chart", value: "Spending by category · last month" }]);
  });
});
