using KaizenReport.Kensho.Core;
using Xunit;

namespace XunitDemo;

[Trait("feature", "Cart")]
[Trait("epic", "Checkout")]
public class CartTests
{
    [Fact]
    [Trait("severity", "critical")]
    [Trait("description", "Adds a single item to an empty cart and shows the total.")]
    [Trait("owner", "alice")]
    [Trait("tag", "smoke")]
    public void Adds_first_item_to_cart()
    {
        using (Kensho.Step("open the storefront"))
        {
            Kensho.Label("surface", "web");
        }

        using (Kensho.Step("add SKU-101 to cart"))
        {
            using (Kensho.Step("warm up CDN"))
            {
                Assert.Equal(2, 1 + 1);
            }
        }

        Kensho.Link("https://jira.example.com/browse/CART-1",
                    kind: "jira", label: "CART-1");
    }

    [Fact]
    [Trait("severity", "blocker")]
    public void Empty_cart_shows_CTA()
    {
        using (Kensho.Step("verify empty CTA copy"))
        {
            Assert.Equal("Start shopping", "Add your first item");
        }
    }

    [Fact(Skip = "Backend endpoint not migrated yet")]
    public void Saves_for_later() { }

    [Theory]
    [InlineData(1, 2, 3)]
    [InlineData(2, 3, 5)]
    [InlineData(10, 15, 25)]
    [Trait("severity", "normal")]
    public void Sums_line_items(int a, int b, int expected)
    {
        Assert.Equal(expected, a + b);
    }
}
