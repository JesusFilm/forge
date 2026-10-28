@main
struct NativeChoiceConfirmationTests {
  static func main() {
    var choice = NativeChoiceConfirmation()
    assert(choice.request(id: "thai", message: "Different version") == nil)
    assert(choice.resolve(accepted: true) == "thai")
    assert(choice.resolve(accepted: true) == nil)

    assert(choice.request(id: "thai", message: "Different version") == nil)
    assert(choice.resolve(accepted: false) == nil)
    assert(choice.resolve(accepted: true) == nil)

    assert(choice.request(id: "english", message: nil) == "english")
    assert(choice.resolve(accepted: true) == nil)

    _ = choice.request(id: "thai", message: "Different version")
    _ = choice.request(id: "polish", message: "Different version")
    assert(choice.resolve(accepted: true) == "polish")
    print("NativeChoiceConfirmation: 4 lifecycle cases passed")
  }
}
