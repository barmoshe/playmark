// The toy's whole look, one line per shape. Playmark notes become edits here.
// kind: circle, square, triangle, hexagon, star. motion: pulse, wobble, bob, spin, hop.
public static class ToyLooks
{
    public static readonly (string name, string kind, string color, string motion)[] Shapes =
    {
        ("Sunny", "circle", "#FFD23F", "pulse"),
        ("Boxy", "square", "#2EC4B6", "wobble"),
        ("Pointy", "triangle", "#FF4F8B", "bob"),
        ("Nutty", "hexagon", "#4D7CFE", "spin"),
    };
}
