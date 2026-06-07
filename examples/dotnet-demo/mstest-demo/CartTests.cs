using System.Collections.Generic;
using KaizenReport.Kensho.Core;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace MSTestDemo;

[TestClass]
[TestCategory("feature:Cart")]
[TestCategory("epic:Checkout")]
public class CartTests
{
    [TestMethod]
    [Description("Adds a single item to an empty cart and shows the total.")]
    [Owner("alice")]
    [Priority(1)]
    [TestCategory("smoke")]
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
                Assert.AreEqual(2, 1 + 1);
            }
        }

        Kensho.Link("https://jira.example.com/browse/CART-1",
                    kind: "jira", label: "CART-1");
    }

    [TestMethod]
    [Priority(0)]
    public void Empty_cart_shows_CTA()
    {
        using (Kensho.Step("verify empty CTA copy"))
        {
            Assert.AreEqual("Start shopping", "Add your first item");
        }
    }

    [TestMethod]
    [Ignore("Backend endpoint not migrated yet")]
    public void Saves_for_later() { }

    [DataTestMethod]
    [DataRow(1, 2, 3)]
    [DataRow(2, 3, 5)]
    [DataRow(10, 15, 25)]
    [Priority(2)]
    public void Sums_line_items(int a, int b, int expected)
    {
        Assert.AreEqual(expected, a + b);
    }

    [TestMethod]
    [TestProperty("severity", "minor")]
    [TestProperty("Feature", "Cart")]
    [TestProperty("Story", "Free-form trait demo")]
    public void Inspects_metadata()
    {
        Assert.IsTrue(true);
    }
}
