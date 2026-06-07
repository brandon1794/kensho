package com.example;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.fail;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.kaizenreport.kensho.Kensho;
import com.kaizenreport.kensho.annotations.Critical;
import com.kaizenreport.kensho.annotations.Description;
import com.kaizenreport.kensho.annotations.Epic;
import com.kaizenreport.kensho.annotations.Feature;
import com.kaizenreport.kensho.annotations.Link;
import com.kaizenreport.kensho.annotations.Owner;
import com.kaizenreport.kensho.annotations.Severity;
import com.kaizenreport.kensho.annotations.Story;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Epic("Checkout")
@Feature("Authentication")
class LoginTest {

  @Test
  @DisplayName("login: happy path")
  @Story("Existing user signs in with the right password")
  @Critical
  @Owner("alice")
  @Tag("smoke")
  @Link(url = "https://jira.example.com/browse/PROJ-123", kind = "jira", label = "PROJ-123")
  void happyPath() throws IOException {
    try (var s = Kensho.step("open the login page")) {
      // simulate page open
    }
    try (var s = Kensho.step("submit credentials")) {
      Kensho.label("team", "growth");
      try (var nested = Kensho.step("verify redirect")) {
        assertEquals(2, 1 + 1);
      }
    }
    Path screenshot = Files.createTempFile("kensho-demo-screenshot-", ".png");
    Files.write(screenshot, new byte[] {(byte) 0x89, 'P', 'N', 'G'});
    Kensho.attach(screenshot, "screenshot");
  }

  @Test
  @DisplayName("login: rejects bad password")
  @Severity("blocker")
  @Story("Wrong password gets a clear error")
  @Tag("smoke")
  void invalidPassword() {
    try (var s = Kensho.step("submit credentials")) {
      fail("Expected redirect to /home but got /login?error=1");
    }
  }

  @Test
  @DisplayName("login: TODO new SSO flow")
  @Disabled("waiting on identity team")
  @Story("Single sign-on will replace the password form")
  void skippedFeature() {
    /* never runs */
  }

  @Test
  @DisplayName("login: broken external dep")
  @Description("Demonstrates a setup-side failure mapped to status=broken via assumeTrue.")
  void brokenSetup() {
    assumeTrue(false, "auth backend is offline");
  }
}
