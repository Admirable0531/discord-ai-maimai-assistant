# The written hand rules

One decision tree distilled from the L. R. breakdown videos (21 videos, 86792 training rows after correction rounds). Read each rule top to bottom: when every condition holds, the simulated player uses the hand named. "In N situations" is how many training situations ended in that rule and the percentage is how often the human used that hand there.

1. **RIGHT hand** (96% of 10108 situations)
   - the note is right of the screen centre (x > 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is more than 0.1
   - the right hand last played more than 0.114 s ago
   - the left hand is more than 0.933 ring radii from the note
   - the note is right of the screen centre (x > 0.706)
2. **LEFT hand** (96% of 9987 situations)
   - the note is left of the screen centre (x <= 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is at most 0.9
   - the right hand is more than 0.659 ring radii from the note
   - the left hand last played more than 0.119 s ago
   - the note is left of the screen centre (x <= -0.529)
3. **RIGHT hand** (91% of 6977 situations)
   - the note is right of the screen centre (x > 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is more than 0.1
   - the right hand last played more than 0.114 s ago
   - the left hand is more than 0.933 ring radii from the note
   - the note is left of the screen centre (x <= 0.706)
4. **LEFT hand** (87% of 6832 situations)
   - the note is left of the screen centre (x <= 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is at most 0.9
   - the right hand is more than 0.659 ring radii from the note
   - the left hand last played within 0.119 s ago
   - the note is left of the screen centre (x <= -0.318)
5. **LEFT hand** (88% of 6794 situations)
   - the note is left of the screen centre (x <= 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is at most 0.9
   - the right hand is more than 0.659 ring radii from the note
   - the left hand last played more than 0.119 s ago
   - the note is right of the screen centre (x > -0.529)
6. **RIGHT hand** (88% of 5938 situations)
   - the note is right of the screen centre (x > 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is more than 0.1
   - the right hand last played within 0.114 s ago
   - the note is right of the screen centre (x > 0.374)
   - the left hand is more than 1.174 ring radii from the note
7. **RIGHT hand** (52% of 5484 situations)
   - the note is left of the screen centre (x <= 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is at most 0.9
   - the right hand is within 0.659 ring radii from the note
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is more than 0.464
   - the note two back was played by the right hand (value 0.25; 0 left, 1 right)
8. **LEFT hand** (53% of 5443 situations)
   - the note is right of the screen centre (x > 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is more than 0.1
   - the right hand last played within 0.114 s ago
   - the note is left of the screen centre (x <= 0.374)
   - the right hand is more than 0.635 ring radii from the note
9. **LEFT hand** (58% of 4456 situations)
   - the note is left of the screen centre (x <= 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is at most 0.9
   - the right hand is more than 0.659 ring radii from the note
   - the left hand last played within 0.119 s ago
   - the note is right of the screen centre (x > -0.318)
10. **LEFT hand** (70% of 3812 situations)
   - the note is left of the screen centre (x <= 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is at most 0.9
   - the right hand is within 0.659 ring radii from the note
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is more than 0.464
   - the note two back was played by the left hand (value 0.25; 0 left, 1 right)
11. **RIGHT hand** (81% of 3524 situations)
   - the note is right of the screen centre (x > 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is more than 0.1
   - the right hand last played within 0.114 s ago
   - the note is right of the screen centre (x > 0.374)
   - the left hand is within 1.174 ring radii from the note
12. **RIGHT hand** (82% of 3366 situations)
   - the note is right of the screen centre (x > 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is more than 0.1
   - the right hand last played within 0.114 s ago
   - the note is left of the screen centre (x <= 0.374)
   - the right hand is within 0.635 ring radii from the note
13. **RIGHT hand** (89% of 3263 situations)
   - the note is right of the screen centre (x > 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is more than 0.1
   - the right hand last played more than 0.114 s ago
   - the left hand is within 0.933 ring radii from the note
   - the note two back was played by the right hand (value 0.25; 0 left, 1 right)
14. **RIGHT hand** (67% of 3087 situations)
   - the note is right of the screen centre (x > 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is more than 0.1
   - the right hand last played more than 0.114 s ago
   - the left hand is within 0.933 ring radii from the note
   - the note two back was played by the left hand (value 0.25; 0 left, 1 right)
15. **LEFT hand** (88% of 1657 situations)
   - the note is left of the screen centre (x <= 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is at most 0.9
   - the right hand is within 0.659 ring radii from the note
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is at most 0.464
   - the previous note was more than 0.109 s earlier
16. **LEFT hand** (70% of 1573 situations)
   - the note is left of the screen centre (x <= 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is at most 0.9
   - the right hand is within 0.659 ring radii from the note
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is at most 0.464
   - the previous note was less than 0.109 s earlier
17. **RIGHT hand** (92% of 1008 situations)
   - the note is left of the screen centre (x <= 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is more than 0.9
   - the note is right of the screen centre (x > -0.374)
   - the left hand is more than 0.475 ring radii from the note
   - the right hand last played more than 0.098 s ago
18. **LEFT hand** (61% of 862 situations)
   - the note is right of the screen centre (x > 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is at most 0.1
   - the note is in the upper part of the screen (y <= 0.529)
   - the note is left of the screen centre (x <= 0.374)
   - the right hand last played more than -0.333 s ago
19. **LEFT hand** (93% of 767 situations)
   - the note is right of the screen centre (x > 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is at most 0.1
   - the note is in the lower part of the screen (y > 0.529)
   - it is not a slide
   - the right hand last played more than -0.315 s ago
20. **RIGHT hand** (70% of 577 situations)
   - the note is right of the screen centre (x > 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is at most 0.1
   - the note is in the upper part of the screen (y <= 0.529)
   - the note is right of the screen centre (x > 0.374)
   - the right hand last played more than -0.271 s ago
21. **RIGHT hand** (80% of 316 situations)
   - the note is left of the screen centre (x <= 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is more than 0.9
   - the note is right of the screen centre (x > -0.374)
   - the left hand is more than 0.475 ring radii from the note
   - the right hand last played within 0.098 s ago
22. **RIGHT hand** (91% of 210 situations)
   - the note is right of the screen centre (x > 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is at most 0.1
   - the note is in the upper part of the screen (y <= 0.529)
   - the note is right of the screen centre (x > 0.374)
   - the right hand last played within -0.271 s ago
23. **RIGHT hand** (77% of 181 situations)
   - the note is right of the screen centre (x > 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is at most 0.1
   - the note is in the upper part of the screen (y <= 0.529)
   - the note is left of the screen centre (x <= 0.374)
   - the right hand last played within -0.333 s ago
24. **LEFT hand** (76% of 123 situations)
   - the note is right of the screen centre (x > 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is at most 0.1
   - the note is in the lower part of the screen (y > 0.529)
   - it is a slide
   - the left hand last played within 0.236 s ago
25. **RIGHT hand** (66% of 77 situations)
   - the note is right of the screen centre (x > 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is at most 0.1
   - the note is in the lower part of the screen (y > 0.529)
   - it is a slide
   - the left hand last played more than 0.236 s ago
26. **LEFT hand** (86% of 70 situations)
   - the note is left of the screen centre (x <= 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is more than 0.9
   - the note is left of the screen centre (x <= -0.374)
   - the right hand last played within 0.296 s ago
   - the right hand is more than 0.647 ring radii from the note
27. **RIGHT hand** (59% of 69 situations)
   - the note is left of the screen centre (x <= 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is more than 0.9
   - the note is left of the screen centre (x <= -0.374)
   - the right hand last played within 0.296 s ago
   - the right hand is within 0.647 ring radii from the note
28. **RIGHT hand** (54% of 65 situations)
   - the note is right of the screen centre (x > 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is at most 0.1
   - the note is in the lower part of the screen (y > 0.529)
   - it is not a slide
   - the right hand last played within -0.315 s ago
29. **RIGHT hand** (84% of 63 situations)
   - the note is left of the screen centre (x <= 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is more than 0.9
   - the note is right of the screen centre (x > -0.374)
   - the left hand is within 0.475 ring radii from the note
   - the note is in the lower part of the screen (y > 0.538)
30. **LEFT hand** (62% of 58 situations)
   - the note is left of the screen centre (x <= 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is more than 0.9
   - the note is right of the screen centre (x > -0.374)
   - the left hand is within 0.475 ring radii from the note
   - the note is in the upper part of the screen (y <= 0.538)
31. **RIGHT hand** (71% of 45 situations)
   - the note is left of the screen centre (x <= 0)
   - its left-to-right position among notes at the same moment (0 leftmost, 1 rightmost) is more than 0.9
   - the note is left of the screen centre (x <= -0.374)
   - the right hand last played more than 0.296 s ago
