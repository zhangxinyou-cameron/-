using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("知习启动器")]
[assembly: AssemblyDescription("知习技术练习室启动入口")]
[assembly: AssemblyCompany("TechPractice")]
[assembly: AssemblyProduct("知习")]
[assembly: AssemblyVersion("0.2.0.0")]
[assembly: AssemblyFileVersion("0.2.0.0")]

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string[] candidates = {
            Path.Combine(root, "TechPractice.exe"),
            Path.Combine(root, "tech-practice", "release", "TechPractice-win32-x64", "TechPractice.exe")
        };
        string executable = candidates.FirstOrDefault(File.Exists);
        if (executable == null)
        {
            MessageBox.Show("没有找到知习主程序。请保留启动器与程序文件夹的目录关系，或重新解压完整的软件包。", "知习 · 无法启动", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 1;
        }
        try
        {
            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = Path.GetFullPath(executable);
            start.WorkingDirectory = Path.GetDirectoryName(start.FileName);
            start.Arguments = String.Join(" ", args.Select(QuoteArgument));
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            Process.Start(start);
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show("知习未能启动：\n" + error.Message, "知习 · 无法启动", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 2;
        }
    }

    // Quote arguments using the Windows process command-line rules, not a shell.
    private static string QuoteArgument(string value)
    {
        StringBuilder result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') result.Append('\\', slashes * 2 + 1).Append(c);
            else result.Append('\\', slashes).Append(c);
            slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }
}
