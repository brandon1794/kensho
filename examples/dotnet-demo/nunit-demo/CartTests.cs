using KaizenReport.Kensho.Core;
using NUnit.Framework;

namespace NUnitDemo;

[TestFixture]
[Category("feature:Cart")]
[Category("epic:Checkout")]
public class CartTests
{
    [Test]
    [Description("Adds a single item to an empty cart and shows the total.")]
    [Author("alice")]
    [Category("severity:critical")]
    [Category("smoke")]
    public void Adds_first_item_to_cart()
    {
        using (Kensho.Step("open the storefront"))
        {
            // pretend-navigate
            Kensho.Label("surface", "web");
        }

        using (Kensho.Step("add SKU-101 to cart"))
        {
            using (Kensho.Step("warm up CDN"))
            {
                Assert.That(1 + 1, Is.EqualTo(2));
            }
        }

        Kensho.Link("https://jira.example.com/browse/CART-1",
                    kind: "jira", label: "CART-1");
    }

    [Test]
    [Category("severity:blocker")]
    public void Empty_cart_shows_CTA()
    {
        using (Kensho.Step("verify empty CTA copy"))
        {
            // intentional failure to exercise the fail path
            Assert.That("Add your first item", Is.EqualTo("Start shopping"));
        }
    }

    [Test]
    [Ignore("Backend endpoint not migrated yet")]
    public void Saves_for_later() { }

    [TestCase(1, 2, 3)]
    [TestCase(2, 3, 5)]
    [TestCase(10, 15, 25)]
    [Category("severity:normal")]
    public void Sums_line_items(int a, int b, int expected)
    {
        Assert.That(a + b, Is.EqualTo(expected));
    }

    [Test]
    [Property("Severity", "minor")]
    [Property("Feature", "Cart")]
    [Property("Story", "Inconclusive backend probe")]
    public void Probe_returns_inconclusive()
    {
        Assert.Inconclusive("backend probe pending");
    }
}
