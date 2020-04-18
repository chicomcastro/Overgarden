using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class Holder : MonoBehaviour
{
    public GameObject target;

    private void Update()
    {
        if (Input.GetKey(KeyCode.E)) {
            target.transform.SetParent(this.gameObject.transform);
        }
    }
}
