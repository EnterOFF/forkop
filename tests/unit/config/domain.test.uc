let t = require("t");
let domain = require("config.domain");

t.test("a domain is lowered and an international one encoded", () => {
    t.eq(domain.suffix_to_ascii("Example.COM"), "example.com");
    t.eq(domain.suffix_to_ascii("пример.рф"), "xn--e1afmkfd.xn--p1ai");
    t.eq(domain.suffix_to_ascii("xn--p1ai"), "xn--p1ai");
});

t.test("an ASCII label that is not a label is refused, not encoded into one", () => {
    for (let value in [ "-a.com", "a-.com", "a..com", "a_b.com" ])
        t.eq(domain.suffix_to_ascii(value), null, value);
});

t.done();
