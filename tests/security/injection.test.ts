/**
 * Security Tests - Injection Prevention
 */

describe('SQL Injection Prevention', () => {
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|TRUNCATE|EXEC|EXECUTE)\b)/gi,
    /(--|#|\/\*)/g,
    /('|")\s*(OR|AND)\s*('|"|\d)/gi,
    /;\s*(SELECT|INSERT|UPDATE|DELETE|DROP)/gi,
    /\bOR\b\s+\d+\s*=\s*\d+/gi,
    /\bAND\b\s+\d+\s*=\s*\d+/gi,
  ];

  const detectSQLInjection = (input: string): boolean => {
    return sqlPatterns.some(pattern => pattern.test(input));
  };

  describe('Basic SQL Injection', () => {
    it('should detect SELECT injection', () => {
      expect(detectSQLInjection("' OR SELECT * FROM users--")).toBe(true);
    });

    it('should detect DROP injection', () => {
      expect(detectSQLInjection("'; DROP TABLE users;--")).toBe(true);
    });

    it('should detect UNION injection', () => {
      expect(detectSQLInjection("' UNION SELECT password FROM users--")).toBe(true);
    });

    it('should detect comment-based injection', () => {
      expect(detectSQLInjection("admin'--")).toBe(true);
    });

    it('should detect OR 1=1 injection', () => {
      expect(detectSQLInjection("' OR 1=1--")).toBe(true);
    });

    it('should allow normal input', () => {
      expect(detectSQLInjection("John Doe")).toBe(false);
    });

    it('should allow email addresses', () => {
      expect(detectSQLInjection("user@example.com")).toBe(false);
    });
  });

  describe('Advanced SQL Injection', () => {
    it('should detect hex-encoded injection', () => {
      const hexPattern = /0x[0-9A-Fa-f]+/;
      expect(hexPattern.test("0x27204F522031")).toBe(true);
    });

    it('should detect stacked queries', () => {
      expect(detectSQLInjection("'; INSERT INTO users VALUES('hacker')--")).toBe(true);
    });

    it('should detect time-based blind injection keywords', () => {
      const timePattern = /\b(SLEEP|WAITFOR|BENCHMARK|DELAY)\b/gi;
      expect(timePattern.test("'; SLEEP(5)--")).toBe(true);
    });

    it('should detect boolean-based blind injection', () => {
      expect(detectSQLInjection("' AND 1=1--")).toBe(true);
    });

    it('should detect EXEC/EXECUTE injection', () => {
      const execPattern = /\b(EXEC|EXECUTE)\s*\(/gi;
      expect(execPattern.test("'; EXEC('DROP TABLE users')--")).toBe(true);
    });
  });

  describe('Obfuscated SQL Injection', () => {
    it('should detect case variations', () => {
      expect(detectSQLInjection("' oR SeLeCt * FrOm users--")).toBe(true);
    });

    it('should detect whitespace variations', () => {
      expect(detectSQLInjection("'\tOR\n1=1--")).toBe(true);
    });

    it('should detect URL-encoded characters', () => {
      const decoded = decodeURIComponent("'%20OR%201=1--");
      expect(detectSQLInjection(decoded)).toBe(true);
    });

    it('should detect double-URL-encoded characters', () => {
      const decoded = decodeURIComponent(decodeURIComponent("%2527%2520OR%25201%253D1--"));
      expect(detectSQLInjection(decoded)).toBe(true);
    });
  });
});

describe('XSS Prevention', () => {
  const xssPatterns = [
    /<script\b[^>]*>[\s\S]*?<\/script>/gi,
    /<script\b[^>]*>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<iframe\b[^>]*>/gi,
    /<object\b[^>]*>/gi,
    /<embed\b[^>]*>/gi,
    /expression\s*\(/gi,
    /url\s*\(\s*['"]*javascript:/gi,
  ];

  const detectXSS = (input: string): boolean => {
    return xssPatterns.some(pattern => pattern.test(input));
  };

  describe('Basic XSS', () => {
    it('should detect script tags', () => {
      expect(detectXSS("<script>alert('XSS')</script>")).toBe(true);
    });

    it('should detect javascript: URLs', () => {
      expect(detectXSS("<a href='javascript:alert(1)'>click</a>")).toBe(true);
    });

    it('should detect onclick handlers', () => {
      expect(detectXSS("<div onclick='alert(1)'>")).toBe(true);
    });

    it('should detect onerror handlers', () => {
      expect(detectXSS("<img src=x onerror='alert(1)'>")).toBe(true);
    });

    it('should detect onload handlers', () => {
      expect(detectXSS("<body onload='alert(1)'>")).toBe(true);
    });

    it('should allow safe HTML', () => {
      expect(detectXSS("<div class='content'>Hello World</div>")).toBe(false);
    });
  });

  describe('Advanced XSS', () => {
    it('should detect iframe injection', () => {
      expect(detectXSS("<iframe src='https://evil.com'>")).toBe(true);
    });

    it('should detect object tag injection', () => {
      expect(detectXSS("<object data='malicious.swf'>")).toBe(true);
    });

    it('should detect embed tag injection', () => {
      expect(detectXSS("<embed src='malicious.swf'>")).toBe(true);
    });

    it('should detect CSS expression', () => {
      expect(detectXSS("style='background:expression(alert(1))'")).toBe(true);
    });

    it('should detect SVG with script', () => {
      const svgPattern = /<svg[^>]*>[\s\S]*?<script/gi;
      expect(svgPattern.test("<svg><script>alert(1)</script></svg>")).toBe(true);
    });
  });

  describe('Obfuscated XSS', () => {
    it('should detect case variations', () => {
      expect(detectXSS("<ScRiPt>alert(1)</sCrIpT>")).toBe(true);
    });

    it('should detect null byte injection', () => {
      const cleaned = "<scr\x00ipt>alert(1)</script>".replace(/\x00/g, '');
      expect(detectXSS(cleaned)).toBe(true);
    });

    it('should detect HTML entity encoding', () => {
      const decoded = "&#60;script&#62;alert(1)&#60;/script&#62;"
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
      expect(detectXSS(decoded)).toBe(true);
    });

    it('should detect URL encoding', () => {
      const decoded = decodeURIComponent("%3Cscript%3Ealert(1)%3C/script%3E");
      expect(detectXSS(decoded)).toBe(true);
    });
  });
});

describe('Command Injection Prevention', () => {
  const cmdPatterns = [
    /[;&|`$()]/g,
    /\$\([^)]*\)/g,
    /`[^`]*`/g,
    /\|\|/g,
    /&&/g,
    />\s*/g,
    /<\s*/g,
  ];

  const detectCommandInjection = (input: string): boolean => {
    return cmdPatterns.some(pattern => pattern.test(input));
  };

  describe('Basic Command Injection', () => {
    it('should detect semicolon injection', () => {
      expect(detectCommandInjection("file.txt; rm -rf /")).toBe(true);
    });

    it('should detect pipe injection', () => {
      expect(detectCommandInjection("file.txt | cat /etc/passwd")).toBe(true);
    });

    it('should detect backtick injection', () => {
      expect(detectCommandInjection("file-`whoami`.txt")).toBe(true);
    });

    it('should detect $() injection', () => {
      expect(detectCommandInjection("file-$(whoami).txt")).toBe(true);
    });

    it('should detect && injection', () => {
      expect(detectCommandInjection("file.txt && rm -rf /")).toBe(true);
    });

    it('should detect || injection', () => {
      expect(detectCommandInjection("file.txt || cat /etc/passwd")).toBe(true);
    });

    it('should allow safe filenames', () => {
      expect(detectCommandInjection("my-file-2024-01-15.txt")).toBe(false);
    });
  });

  describe('Output Redirection', () => {
    it('should detect output redirection', () => {
      expect(detectCommandInjection("file.txt > /etc/passwd")).toBe(true);
    });

    it('should detect input redirection', () => {
      expect(detectCommandInjection("< /etc/passwd")).toBe(true);
    });
  });
});

describe('Path Traversal Prevention', () => {
  const pathPatterns = [
    /\.\.\//g,
    /\.\.\\/,
    /^\//, // Absolute paths starting with /
    /^[a-zA-Z]:\\/, // Windows absolute paths
    /%2e%2e/gi, // URL encoded ..
    /%252e%252e/gi, // Double URL encoded ..
  ];

  const detectPathTraversal = (input: string): boolean => {
    return pathPatterns.some(pattern => pattern.test(input));
  };

  describe('Basic Path Traversal', () => {
    it('should detect ../  traversal', () => {
      expect(detectPathTraversal("../../../etc/passwd")).toBe(true);
    });

    it('should detect ..\\ traversal (Windows)', () => {
      expect(detectPathTraversal("..\\..\\..\\windows\\system32")).toBe(true);
    });

    it('should detect absolute Unix paths', () => {
      expect(detectPathTraversal("/etc/passwd")).toBe(true);
    });

    it('should detect absolute Windows paths', () => {
      expect(detectPathTraversal("C:\\Windows\\System32")).toBe(true);
    });

    it('should allow relative safe paths', () => {
      expect(detectPathTraversal("uploads/user-123/file.txt")).toBe(false);
    });
  });

  describe('Encoded Path Traversal', () => {
    it('should detect URL-encoded traversal', () => {
      expect(detectPathTraversal("%2e%2e/%2e%2e/etc/passwd")).toBe(true);
    });

    it('should detect double-encoded traversal', () => {
      expect(detectPathTraversal("%252e%252e/%252e%252e/etc/passwd")).toBe(true);
    });
  });
});

describe('LDAP Injection Prevention', () => {
  const ldapPatterns = [
    /[()\\*]/g,
    /\x00/g, // Null bytes
    /[\x80-\xFF]/g, // High ASCII
  ];

  const detectLDAPInjection = (input: string): boolean => {
    return ldapPatterns.some(pattern => pattern.test(input));
  };

  describe('Basic LDAP Injection', () => {
    it('should detect wildcard injection', () => {
      expect(detectLDAPInjection("*")).toBe(true);
    });

    it('should detect parenthesis injection', () => {
      expect(detectLDAPInjection(")(uid=*)")).toBe(true);
    });

    it('should detect null byte injection', () => {
      expect(detectLDAPInjection("admin\x00")).toBe(true);
    });

    it('should allow normal usernames', () => {
      expect(detectLDAPInjection("john.doe")).toBe(false);
    });
  });
});

describe('Header Injection Prevention', () => {
  const headerPatterns = [
    /[\r\n]/g,
    /%0d|%0a/gi,
  ];

  const detectHeaderInjection = (input: string): boolean => {
    return headerPatterns.some(pattern => pattern.test(input));
  };

  describe('HTTP Header Injection', () => {
    it('should detect CRLF injection', () => {
      expect(detectHeaderInjection("value\r\nX-Injected: header")).toBe(true);
    });

    it('should detect LF injection', () => {
      expect(detectHeaderInjection("value\nX-Injected: header")).toBe(true);
    });

    it('should detect URL-encoded CRLF', () => {
      expect(detectHeaderInjection("value%0d%0aX-Injected: header")).toBe(true);
    });

    it('should allow normal header values', () => {
      expect(detectHeaderInjection("Bearer eyJhbGciOiJIUzI1NiJ9")).toBe(false);
    });
  });
});

describe('Input Sanitization', () => {
  const sanitizeHTML = (input: string): string => {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  };

  const sanitizeSQL = (input: string): string => {
    return input.replace(/'/g, "''");
  };

  describe('HTML Sanitization', () => {
    it('should escape < and >', () => {
      expect(sanitizeHTML("<script>")).toBe("&lt;script&gt;");
    });

    it('should escape quotes', () => {
      expect(sanitizeHTML('onclick="alert()"')).toBe('onclick=&quot;alert()&quot;');
    });

    it('should escape ampersands', () => {
      expect(sanitizeHTML("&nbsp;")).toBe("&amp;nbsp;");
    });

    it('should preserve safe content', () => {
      expect(sanitizeHTML("Hello World")).toBe("Hello World");
    });
  });

  describe('SQL Sanitization', () => {
    it('should escape single quotes', () => {
      expect(sanitizeSQL("O'Brien")).toBe("O''Brien");
    });

    it('should double escape multiple quotes', () => {
      expect(sanitizeSQL("It's a 'test'")).toBe("It''s a ''test''");
    });

    it('should preserve safe content', () => {
      expect(sanitizeSQL("John Doe")).toBe("John Doe");
    });
  });
});

describe('Validation Functions', () => {
  const isValidEmail = (email: string): boolean => {
    const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return pattern.test(email) && email.length <= 254;
  };

  const isValidUUID = (uuid: string): boolean => {
    const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return pattern.test(uuid);
  };

  const isValidFilename = (filename: string): boolean => {
    const pattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
    return pattern.test(filename) && filename.length <= 255;
  };

  describe('Email Validation', () => {
    it('should accept valid email', () => {
      expect(isValidEmail("user@example.com")).toBe(true);
    });

    it('should reject email without @', () => {
      expect(isValidEmail("userexample.com")).toBe(false);
    });

    it('should reject email without domain', () => {
      expect(isValidEmail("user@")).toBe(false);
    });

    it('should reject too long email', () => {
      const longEmail = 'a'.repeat(250) + '@example.com';
      expect(isValidEmail(longEmail)).toBe(false);
    });
  });

  describe('UUID Validation', () => {
    it('should accept valid UUID', () => {
      expect(isValidUUID("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    });

    it('should reject invalid UUID', () => {
      expect(isValidUUID("not-a-uuid")).toBe(false);
    });

    it('should reject UUID with wrong version', () => {
      expect(isValidUUID("550e8400-e29b-91d4-a716-446655440000")).toBe(false);
    });
  });

  describe('Filename Validation', () => {
    it('should accept valid filename', () => {
      expect(isValidFilename("document.pdf")).toBe(true);
    });

    it('should reject path traversal', () => {
      expect(isValidFilename("../etc/passwd")).toBe(false);
    });

    it('should reject starting with dot', () => {
      expect(isValidFilename(".htaccess")).toBe(false);
    });

    it('should reject special characters', () => {
      expect(isValidFilename("file<script>.txt")).toBe(false);
    });
  });
});
