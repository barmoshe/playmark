using System;
using System.IO;
using System.IO.Compression;
using System.Text;

namespace BarBuilds.Playmark.Core
{
    /// <summary>
    /// A small PNG encoder (8-bit RGBA, one IDAT). Ours so it runs on any thread and in tests
    /// without Unity; marks are written on a worker so saving never hitches the game.
    /// </summary>
    public static class Png
    {
        static readonly uint[] CrcTable = MakeCrcTable();

        public static byte[] Encode(RgbaImage img)
        {
            using var output = new MemoryStream();
            output.Write(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }, 0, 8);

            var ihdr = new byte[13];
            WriteBigEndian(ihdr, 0, (uint)img.Width);
            WriteBigEndian(ihdr, 4, (uint)img.Height);
            ihdr[8] = 8;  // bit depth
            ihdr[9] = 6;  // RGBA
            WriteChunk(output, "IHDR", ihdr);

            // Each row: filter "Sub" (the left neighbour), which shrinks flat game art well.
            var stride = img.Width * 4;
            var raw = new byte[(stride + 1) * img.Height];
            for (var y = 0; y < img.Height; y++)
            {
                var o = y * (stride + 1);
                var s = y * stride;
                raw[o] = 1;
                for (var x = 0; x < stride; x++)
                    raw[o + 1 + x] = (byte)(img.Pixels[s + x] - (x >= 4 ? img.Pixels[s + x - 4] : 0));
            }
            WriteChunk(output, "IDAT", Zlib(raw));
            WriteChunk(output, "IEND", Array.Empty<byte>());
            return output.ToArray();
        }

        /// <summary>zlib framing around a raw deflate stream (netstandard2.1 has no ZLibStream).</summary>
        static byte[] Zlib(byte[] data)
        {
            using var ms = new MemoryStream();
            ms.WriteByte(0x78);
            ms.WriteByte(0x01);
            using (var deflate = new DeflateStream(ms, CompressionLevel.Fastest, true))
                deflate.Write(data, 0, data.Length);
            uint a = 1, b = 0;
            foreach (var x in data)
            {
                a = (a + x) % 65521;
                b = (b + a) % 65521;
            }
            var adler = new byte[4];
            WriteBigEndian(adler, 0, (b << 16) | a);
            ms.Write(adler, 0, 4);
            return ms.ToArray();
        }

        static void WriteChunk(Stream s, string type, byte[] data)
        {
            var len = new byte[4];
            WriteBigEndian(len, 0, (uint)data.Length);
            s.Write(len, 0, 4);
            var typeBytes = Encoding.ASCII.GetBytes(type);
            s.Write(typeBytes, 0, 4);
            s.Write(data, 0, data.Length);
            var crc = 0xFFFFFFFFu;
            crc = Update(crc, typeBytes);
            crc = Update(crc, data);
            var crcBytes = new byte[4];
            WriteBigEndian(crcBytes, 0, crc ^ 0xFFFFFFFFu);
            s.Write(crcBytes, 0, 4);
        }

        static uint Update(uint crc, byte[] data)
        {
            foreach (var x in data) crc = CrcTable[(crc ^ x) & 0xFF] ^ (crc >> 8);
            return crc;
        }

        static uint[] MakeCrcTable()
        {
            var t = new uint[256];
            for (uint n = 0; n < 256; n++)
            {
                var c = n;
                for (var k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
                t[n] = c;
            }
            return t;
        }

        static void WriteBigEndian(byte[] b, int at, uint v)
        {
            b[at] = (byte)(v >> 24);
            b[at + 1] = (byte)(v >> 16);
            b[at + 2] = (byte)(v >> 8);
            b[at + 3] = (byte)v;
        }
    }
}
