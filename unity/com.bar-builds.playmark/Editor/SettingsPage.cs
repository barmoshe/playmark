using System.IO;
using UnityEditor;
using UnityEngine;

namespace BarBuilds.Playmark.EditorTools
{
    /// <summary>Project Settings, Playmark. Edits Assets/Resources/PlaymarkSettings.asset.</summary>
    internal static class SettingsPage
    {
        const string AssetPath = "Assets/Resources/" + PlaymarkSettings.ResourceName + ".asset";

        [SettingsProvider]
        static SettingsProvider Create()
        {
            return new SettingsProvider("Project/Playmark", SettingsScope.Project)
            {
                label = "Playmark",
                guiHandler = _ => Draw(),
                keywords = new[] { "Playmark", "mark", "playtest", "feedback", "Claude", "ghosts", "clip" },
            };
        }

        static void Draw()
        {
            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Press " + PlaymarkSettings.Current.shortcut + " while playing to mark what you see. Marks go to:", EditorStyles.wordWrappedLabel);
            using (new EditorGUILayout.HorizontalScope())
            {
                EditorGUILayout.SelectableLabel(PlaymarkEditor.Root, EditorStyles.textField, GUILayout.Height(EditorGUIUtility.singleLineHeight));
                if (GUILayout.Button("Open", GUILayout.Width(60)))
                {
                    Directory.CreateDirectory(Path.Combine(PlaymarkEditor.Root, "inbox"));
                    EditorUtility.RevealInFinder(Path.Combine(PlaymarkEditor.Root, "inbox"));
                }
            }
            EditorGUILayout.Space();

            var asset = Resources.Load<PlaymarkSettings>(PlaymarkSettings.ResourceName);
            if (asset == null)
            {
                EditorGUILayout.HelpBox("Playmark runs with its defaults. Create a settings asset to change them.", MessageType.Info);
                if (GUILayout.Button("Create " + AssetPath))
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(AssetPath) ?? "Assets/Resources");
                    AssetDatabase.CreateAsset(ScriptableObject.CreateInstance<PlaymarkSettings>(), AssetPath);
                    AssetDatabase.SaveAssets();
                }
            }
            else
            {
                var so = new SerializedObject(asset);
                var it = so.GetIterator();
                for (var enter = true; it.NextVisible(enter); enter = false)
                {
                    if (it.propertyPath == "m_Script") continue;
                    EditorGUILayout.PropertyField(it, true);
                }
                so.ApplyModifiedProperties();
            }

            EditorGUILayout.Space();
            using (new EditorGUI.DisabledScope(EditorApplication.isPlayingOrWillChangePlaymode))
            {
                if (GUILayout.Button("Run Smoke Test", GUILayout.Width(160))) PlaymarkEditor.RunSmoke();
            }
            EditorGUILayout.LabelField("Plays 6 s, opens the overlay, marks, saves, stops. A quick check that Playmark works in this project.", EditorStyles.miniLabel);
        }
    }
}
