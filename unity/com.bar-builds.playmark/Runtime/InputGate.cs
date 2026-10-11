using UnityEngine.EventSystems;
#if PLAYMARK_INPUT_SYSTEM
using System.Collections.Generic;
using UnityEngine.InputSystem;
#endif

namespace BarBuilds.Playmark
{
    /// <summary>
    /// Keeps the game from reading input while the overlay is open. Time.timeScale = 0 stops
    /// physics and scaled time, but Update still runs. With the Input System, every enabled
    /// action is disabled and exactly those come back on close. The scene's EventSystem is
    /// switched off too, so a click on the overlay never lands on a uGUI button under it.
    /// With the old Input Manager there is no switch for Input.GetKey: games can check
    /// Playmark.IsOpen.
    /// </summary>
    internal static class InputGate
    {
        static EventSystem _eventSystem;

#if PLAYMARK_INPUT_SYSTEM
        static List<InputAction> _blocked;
#endif

        public static void Block()
        {
            _eventSystem = EventSystem.current != null && EventSystem.current.enabled ? EventSystem.current : null;
            if (_eventSystem != null) _eventSystem.enabled = false;
#if PLAYMARK_INPUT_SYSTEM
            _blocked = InputSystem.ListEnabledActions();
            foreach (var a in _blocked) a.Disable();
#endif
        }

        public static void Release()
        {
            if (_eventSystem != null) _eventSystem.enabled = true;
            _eventSystem = null;
#if PLAYMARK_INPUT_SYSTEM
            if (_blocked == null) return;
            foreach (var a in _blocked) a.Enable();
            _blocked = null;
#endif
        }
    }
}
